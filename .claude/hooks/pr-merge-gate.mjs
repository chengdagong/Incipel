#!/usr/bin/env node
// PreToolUse 钩子:在 Claude 执行 `gh pr merge` 之前校验评审记录。
// 只有当待合并分支存在一份评审记录、且每条问题都已 fixed 或写明 wont-fix 理由、
// 且评审覆盖的提交就是该分支最新提交时,才放行;否则拒绝本次 merge。
//
// 说明:此关卡只约束经由 Claude Code 运行的 `gh pr merge`。
// 在 github.com 网页点 Merge、或本地 `git merge` 不在其管辖范围内。
//
// 紧急放行:在命令前加 `CODEX_REVIEW_BYPASS=1`(如
// `CODEX_REVIEW_BYPASS=1 gh pr merge ...`)即跳过本关卡。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.trim();
}

// 拒绝放行:输出 PreToolUse 的 deny 决定,原因回传给 Claude。
function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
  process.exit(0);
}

const BYPASS_HINT =
  "如确需跳过评审关卡,可改用 `CODEX_REVIEW_BYPASS=1 gh pr merge ...`。";

function main() {
  const input = readHookInput();
  if (input.tool_name !== "Bash") return; // 非 Bash,放行

  const command = String(input?.tool_input?.command ?? "");
  if (!/\bgh\s+pr\s+merge\b/.test(command)) return; // 非 merge,放行

  // 紧急放行通道。
  if (/\bCODEX_REVIEW_BYPASS\s*=\s*1\b/.test(command)) {
    process.stderr.write("已通过 CODEX_REVIEW_BYPASS 跳过 Codex 评审关卡。\n");
    return;
  }

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // 解析 merge 的目标:`gh pr merge [<number|url|branch>] [flags]`。
  // 取 merge 之后第一个不以 `-` 开头的 token 作为目标;没有则表示当前分支。
  const argMatch = command.match(/\bgh\s+pr\s+merge\s+([^\s-][^\s]*)/);
  const target = argMatch ? argMatch[1] : null;

  let branch;
  let expectedCommit;
  if (target) {
    // 指定了 PR:用 gh 查出它的 head 分支与最新提交。
    const json = run(
      "gh",
      ["pr", "view", target, "--json", "headRefName,headRefOid"],
      cwd
    );
    if (!json) {
      deny(
        `无法解析待合并 PR「${target}」的分支信息,不能确认评审是否完成。请先完成 Codex 评审并写入评审记录,再 merge。${BYPASS_HINT}`
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      deny(`解析 gh pr view 输出失败,无法校验评审。${BYPASS_HINT}`);
    }
    branch = parsed.headRefName;
    expectedCommit = parsed.headRefOid;
  } else {
    branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    expectedCommit = run("git", ["rev-parse", "HEAD"], cwd);
    if (!branch) {
      deny(`无法确定当前分支,不能校验评审。${BYPASS_HINT}`);
    }
  }

  const recordPath = path.join(
    cwd,
    ".codex-review",
    `${branch.replace(/[^A-Za-z0-9._-]/g, "__")}.json`
  );

  if (!fs.existsSync(recordPath)) {
    deny(
      `分支「${branch}」还没有 Codex 评审记录(${path.relative(cwd, recordPath)} 不存在)。` +
        `请先运行 /codex:review 评审本次改动,处理每条问题(修复或写明不修理由)并写入评审记录,再 merge。${BYPASS_HINT}`
    );
  }

  let record;
  try {
    record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  } catch {
    deny(
      `评审记录 ${path.relative(cwd, recordPath)} 不是合法 JSON,无法校验。请修正后重试。${BYPASS_HINT}`
    );
  }

  const problems = [];

  if (record.status !== "resolved") {
    problems.push(`记录 status 不是 "resolved"(当前为 ${JSON.stringify(record.status)})。`);
  }

  const findings = Array.isArray(record.findings) ? record.findings : null;
  if (!findings) {
    problems.push("记录缺少 findings 数组。");
  } else {
    findings.forEach((f, i) => {
      const res = f?.resolution;
      if (res !== "fixed" && res !== "wont-fix") {
        problems.push(`第 ${i + 1} 条问题的 resolution 必须是 "fixed" 或 "wont-fix"(当前为 ${JSON.stringify(res)})。`);
      }
      if (res === "wont-fix" && !String(f?.detail ?? "").trim()) {
        problems.push(`第 ${i + 1} 条问题标记为 wont-fix,但 detail(不修的理由)为空。`);
      }
    });
  }

  // 评审必须覆盖待合并分支的最新提交,否则评审后又改了代码,需重新评审。
  if (expectedCommit && record.reviewedCommit && record.reviewedCommit !== expectedCommit) {
    problems.push(
      `评审记录针对的提交是 ${String(record.reviewedCommit).slice(0, 8)},` +
        `但待合并分支当前提交是 ${expectedCommit.slice(0, 8)};评审后代码有变动,请重新评审。`
    );
  } else if (expectedCommit && !record.reviewedCommit) {
    problems.push("评审记录缺少 reviewedCommit 字段,无法确认评审覆盖了最新代码。");
  }

  if (problems.length > 0) {
    deny(
      `分支「${branch}」的 Codex 评审尚未完成,不能 merge:\n- ${problems.join("\n- ")}\n` +
        `请补齐评审与处理后再 merge。${BYPASS_HINT}`
    );
  }

  // 校验通过:不输出决定,交回正常权限流程(merge 仍会照常征求确认)。
  process.stderr.write(`Codex 评审记录校验通过(${path.relative(cwd, recordPath)})。\n`);
}

try {
  main();
} catch (err) {
  // 安全关卡出错时按拒绝处理(fail-closed),避免漏过未评审的 merge。
  deny(
    `评审关卡运行出错:${String(err?.message ?? err)}。为安全起见已拦截本次 merge。${BYPASS_HINT}`
  );
}
