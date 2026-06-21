# 贡献指南

本文件只列与「能不能合并」直接相关的硬性关卡。日常开发约定见 [README.md](README.md)、
[CLAUDE.md](CLAUDE.md);多 worktree 跑模拟器 / 服务 / 测试的注意事项见
[docs/worktree-dev.md](docs/worktree-dev.md);测试策略见 [ADR-0007](docs/adr/0007-e2e-test-strategy.md)。

## 合并前必跑(人工强制关卡)

每个改动 `apps/mobile` 或 `packages/agent` 的 PR,合并前都要在本地把下面两项跑通,**通过才放行**:

1. **单元 / 集成 + 类型**

   ```bash
   pnpm test          # 各包 Vitest(packages/shared、packages/agent)
   pnpm typecheck     # 各包 tsc --noEmit
   ```

2. **Maestro 端到端(release 包)——`frontend-only` + `stub-agent` 这 6 条**

   ```bash
   pnpm e2e:ios       # 默认即 frontend-only,stub-agent 两层;免 Supabase / Docker
   ```

   这 6 条免 Supabase、是大头价值(门控放行、欢迎页、一条创作首轮、肖像弹窗、抽屉、i18n、出错重试)。
   它以 release 包为运行目标(为什么不跑 dev-client 见 ADR-0007);首次会自动 `expo prebuild` +
   `pod install`,较慢,之后复用。前置(Maestro / JDK / Xcode / CocoaPods)见
   [apps/mobile/.maestro/README.md](apps/mobile/.maestro/README.md)。

> **为什么是人工关卡、暂不进 CI**:macOS 的 CI 跑 iOS 模拟器又贵又慢,先不全塞。稳定后再把这 6 条挪进
> **路径过滤的 CI**(只在动 `apps/mobile` / `packages/agent` 的 PR 上跑)。

## `supabase` 层(发版前 / 夜间手动)

`supabase` 那 3 条(匿名登录、星标、历史续写)最重、且会往**共用的**本地 Supabase 写数据,不进合并关卡:

```bash
supabase start                 # 需本地栈;keys 从 `supabase status -o env` 取
pnpm e2e:ios supabase
```

别在其它 worktree 可能正在测试时跑写数据库的测试或 `supabase db reset`(共用栈,会冲掉别人数据)。

## 真实模型(不进 E2E)

**模型行为明确不在 E2E 范围**(见 ADR-0007)。真实模型另由两条线覆盖,发版前 / 夜间手动跑:

```bash
pnpm --filter @incipel/agent smoke   # 真实 provider + 真 key,断言结构不变量
```

以及「录真实一轮当 fixture、经 stub 确定性回放」压客户端对真实(更乱)产出的渲染。
