#!/usr/bin/env node
// PostToolUse 钩子:Claude 通过 `gh pr create` 成功建好 PR 后,
// 提示 Claude 立刻用 Codex 评审本次改动,并把结果写成评审记录。
// 评审记录是 pr-merge-gate.mjs 放行 `gh pr merge` 的依据。
//
// 本钩子本身不做评审、不改代码,只往上下文里注入一段指令。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// 读取 Claude Code 通过 stdin 传入的钩子输入(JSON)。
function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// 在指定目录运行命令,返回去掉首尾空白的 stdout;失败返回 null。
function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.trim();
}

// 找到 /codex:review 背后的 codex-companion.mjs:优先 cache 里版本号最大的,
// 没有则回退到 marketplace 里的源文件。
function resolveCompanion() {
  const home = os.homedir();
  const cacheBase = path.join(home, ".claude/plugins/cache/openai-codex/codex");
  try {
    const versions = fs
      .readdirSync(cacheBase)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const p = path.join(cacheBase, v, "scripts/codex-companion.mjs");
      if (fs.existsSync(p)) return p;
    }
  } catch {
    // cache 目录不存在时继续尝试 marketplace
  }
  const market = path.join(
    home,
    ".claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
  );
  return fs.existsSync(market) ? market : null;
}

function main() {
  const input = readHookInput();
  if (input.tool_name !== "Bash") return;

  const command = String(input?.tool_input?.command ?? "");
  // 只在 `gh pr create` 上触发(允许命令中夹带其他子句/参数)。
  if (!/\bgh\s+pr\s+create\b/.test(command)) return;

  // 只在创建成功(输出里带 PR 链接)时提示,失败不打扰。
  const responseText = JSON.stringify(input?.tool_response ?? "");
  const prUrlMatch = responseText.match(
    /https:\/\/github\.com\/[^\s"'\\]+\/pull\/\d+/
  );
  if (!prUrlMatch) return;
  const prUrl = prUrlMatch[0];

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd) || "HEAD";
  // 默认分支:从 origin/HEAD 推断,拿不到就用 main。
  const originHead = run("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd);
  const base = originHead ? originHead.replace(/^origin\//, "") : "main";
  const recordRel = `.codex-review/${branch.replace(/[^A-Za-z0-9._-]/g, "__")}.json`;
  const companion = resolveCompanion();

  const reviewCmd = companion
    ? `node "${companion}" review --wait --scope branch --base ${base}`
    : "/codex:review --wait --scope branch --base " + base + "(找不到 codex-companion.mjs,请先运行 /codex:setup)";

  const context = [
    `已创建 Pull Request:${prUrl}(分支 ${branch})。`,
    `本项目要求:PR 建好后必须先做 Codex 评审,处理完发现的问题才允许 merge。请现在执行以下步骤,不要直接 merge:`,
    "",
    `1. 运行 Codex 评审(前台等待结果):`,
    `   ${reviewCmd}`,
    `2. 对评审报告里的每一条问题,二选一:`,
    `   - 修复:改代码并提交(commit),让修复进入这条 PR;`,
    `   - 不修:明确写下不修的理由(为什么可以不修)。`,
    `3. 把评审结论写入评审记录文件 ${recordRel}(相对仓库根目录),JSON 结构如下:`,
    `   {`,
    `     "branch": "${branch}",`,
    `     "prUrl": "${prUrl}",`,
    `     "reviewedCommit": "<写记录时 HEAD 的完整 sha,即修复都提交之后的最新提交>",`,
    `     "reviewedAt": "<ISO 8601 时间>",`,
    `     "status": "resolved",`,
    `     "findings": [`,
    `       { "title": "<问题标题>", "severity": "high|medium|low",`,
    `         "resolution": "fixed", "detail": "<怎么修的,引用 commit>" },`,
    `       { "title": "<问题标题>", "severity": "high|medium|low",`,
    `         "resolution": "wont-fix", "detail": "<不修的具体理由,必填>" }`,
    `     ]`,
    `   }`,
    `   说明:status 只有在每一条问题都已 fixed 或 wont-fix 时才填 "resolved";`,
    `   wont-fix 的 detail 必填;若评审没发现问题,findings 留空数组、status 填 "resolved"。`,
    `4. 写好记录后才可以 merge。merge 关卡会校验这份记录,reviewedCommit 必须等于待合并分支的最新提交,否则视为评审已过期、需要重新评审。`,
  ].join("\n");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: context,
      },
    }) + "\n"
  );
}

try {
  main();
} catch (err) {
  // 提示型钩子出错不应打断流程,仅写到 stderr。
  process.stderr.write(String(err?.message ?? err) + "\n");
}
