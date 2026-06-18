# Incipel — 给 Claude 的项目须知

AI 原生编剧助手「芯」。项目背景见 [README.md](README.md),领域术语见 [CONTEXT.md](CONTEXT.md),
关键决策见 [docs/adr/](docs/adr/)。本文件只放与日常操作相关、容易踩坑的约定。

## 并行 worktree:跑模拟器 / 服务 / 自动化测试前必读

同一台机器上可能有多个 git worktree 同时在开发或测试。模拟器、开发服务、本地 Supabase
都占用机器级的独占资源,**直接照 README「本地开发」里的裸命令跑会与其它 worktree 撞车**:

- Metro 默认端口 `8081`
- agent(Hono)默认端口 `8787`
- iOS / Android 模拟器(Expo CLI 默认指向「最近打开的那台」,多模拟器时会打错)
- 本地 Supabase 栈(CLI 按 `project_id` 归一,多个 worktree **共用同一套**数据库 / auth / storage)

因此在本仓库:

1. **起开发服务或模拟器,用 worktree 感知的脚本,不要用裸命令**:
   - `pnpm dev:ios` / `pnpm dev:android` —— 本 worktree 专属端口 + 专属模拟器,按 UDID / serial 显式定向
   - `pnpm dev:agent` —— 本 worktree 专属的 agent 端口
   它们为每个 worktree 分配互不冲突的 Metro / agent 端口与缓存、各自的模拟器,并把 `apps/mobile/.env`、`packages/agent/.env` 的端口与 URL 接好。机制与取舍见 [docs/worktree-dev.md](docs/worktree-dev.md)。

2. **跑会启动模拟器或长驻服务的自动化测试前**,先确认端口与模拟器不会和别的 worktree 冲突:
   走上面的脚本,或显式指定独立端口 / 设备(`--port`、`expo run:ios --device <UDID>`、`adb -s <serial>`)。
   不要默认 `8081` / `8787` 或某台模拟器只有自己在用。

3. **本地 Supabase 栈是共用的,当心数据互相污染**:
   - 别在其它 worktree 可能正在测试时跑 `supabase db reset` 或写库的测试——会冲掉对方的数据;改动 migration 也要顾及共用方。
   - 只做 UI / agent 逻辑、不需要持久化时,在 `packages/agent/.env` 设 `STORE=memory`、`DEV_NO_AUTH=1`,完全不碰 Supabase。
   - 真要隔离数据库,才考虑每 worktree 一套独立栈(重,取舍见 [docs/worktree-dev.md](docs/worktree-dev.md))。

> 一句话:在多 worktree 的机器上,跑任何模拟或自动化测试前先想「端口 / 模拟器 / 数据库会不会和别人撞」,默认走 `pnpm dev:*` 脚本。
