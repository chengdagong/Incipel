# PR 评审关卡(Codex review gate)

本目录下的钩子让「PR 建好后必须先做 Codex 评审、处理完问题才允许 merge」成为强制流程。
配置见 `../settings.json`,会随仓库一起提交,对所有用本仓库的 Claude Code 会话生效。

## 工作流程

1. **建 PR 后自动提醒** —— `pr-review-reminder.mjs`(PostToolUse)
   Claude 通过 `gh pr create` 成功建好 PR 后,钩子注入一段指令,要求 Claude:
   - 运行 Codex 评审(`/codex:review` 背后的 `codex-companion.mjs`,前台等待结果);
   - 对每条问题二选一:**修复并提交**,或**写明不修的理由**;
   - 把结论写入评审记录 `.codex-review/<分支名>.json`。

2. **merge 前校验** —— `pr-merge-gate.mjs`(PreToolUse)
   Claude 执行 `gh pr merge` 前,钩子校验该分支的评审记录:
   - 记录存在;
   - `status` 为 `"resolved"`;
   - 每条 finding 的 `resolution` 是 `fixed` 或 `wont-fix`(`wont-fix` 必须有 `detail` 理由);
   - `reviewedCommit` 等于待合并分支的最新提交(评审后又改了代码则视为过期)。
   任一不满足即拒绝本次 merge,并说明原因。

## 评审记录格式 `.codex-review/<分支名>.json`

```json
{
  "branch": "claude/example",
  "prUrl": "https://github.com/<owner>/<repo>/pull/123",
  "reviewedCommit": "<完整提交 sha,= 修复都提交后的最新提交>",
  "reviewedAt": "2026-06-18T12:00:00Z",
  "status": "resolved",
  "findings": [
    { "title": "...", "severity": "high|medium|low", "resolution": "fixed", "detail": "怎么修的" },
    { "title": "...", "severity": "low", "resolution": "wont-fix", "detail": "不修的具体理由(必填)" }
  ]
}
```

- 没发现问题:`findings` 留空数组、`status` 填 `"resolved"`。
- 记录文件按分支生成,已加入 `.gitignore`,属于本地关卡产物,不进仓库历史。

## 适用范围与紧急放行

- 该关卡只约束**经由 Claude Code 运行的** `gh pr create` / `gh pr merge`。
  在 github.com 网页点 Merge、或本地直接 `git merge` 不在其管辖范围内 —— 若需要任何人、任何方式都拦得住的硬关卡,需要改用 GitHub 分支保护 + required status check。
- 紧急跳过:`CODEX_REVIEW_BYPASS=1 gh pr merge ...`。
- 评审关卡脚本若自身出错,按**拒绝**处理(fail-closed),避免漏过未评审的 merge;此时同样可用上面的方式临时放行。
