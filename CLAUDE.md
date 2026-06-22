# Incipel — 给 Claude 的项目须知

AI 原生编剧助手「织幕」。项目背景见 [README.md](README.md),领域术语见 [CONTEXT.md](CONTEXT.md),
关键决策见 [docs/adr/](docs/adr/)。本文件只放与日常操作相关、容易踩坑的约定。

## 并行 worktree:跑模拟器 / 服务 / 自动化测试前必读

同一台机器上可能有多个 git worktree 同时在开发或测试。模拟器、开发服务、本地 Supabase
都占用机器级的独占资源,**直接照 README「本地开发」里的裸命令跑会与其它 worktree 撞车**:

- Metro 端口 `8081`(固定;我们总是只跑一个 dev 环境,不再为每个 worktree 错开,见 [docs/worktree-dev.md](docs/worktree-dev.md))
- iOS / Android 模拟器(Expo CLI 默认指向「最近打开的那台」,多模拟器时会打错)
- 本地 Supabase 栈(CLI 按 `project_id` 归一,多个 worktree **共用同一套**数据库 / auth / storage;agent 作为 edge function 挂在它的 API 端口下,没有单独端口)

因此在本仓库:

1. **起开发服务或模拟器,用 worktree 感知的脚本,不要用裸命令**:
   - `pnpm dev:ios` / `pnpm dev:android` —— Metro 固定 8081 + 本 worktree 专属模拟器(按 UDID / serial 定向);起 Metro 前会自动起共用栈、**后台** serve agent(经 `tools/incipel-dev up`,设 `INCIPEL_SKIP_AGENT=1` 可跳过)
   - `pnpm dev:agent` —— **前台**起共用栈 + serve agent(想看 agent 热重载日志时用;edge function,agent 已无 per-worktree 端口,见 [ADR-0008](docs/adr/0008-edge-only-agent-runtime.md))
   它们用固定的 Metro 8081(+ 本 worktree 独立的 Metro 缓存)、各自的模拟器,并把 `apps/mobile/.env` 与 `supabase/.env` 写好。新 worktree 第一次需要 `supabase/.env` 时,`tools/incipel-dev` 必须先从主工作区完整复制该文件,再写本地 JWT 校验变量。机制与取舍见 [docs/worktree-dev.md](docs/worktree-dev.md)。

2. **跑会启动模拟器或长驻服务的自动化测试前**,先确认模拟器 / 共用栈不会和别处冲突:
   走上面的脚本,或显式指定设备(`expo run:ios --device <UDID>`、`adb -s <serial>`)。
   Metro 固定 8081、且只跑一个 dev 环境,所以别同时再起一个占 8081 的 Metro;也别假定某台模拟器只有自己在用。

3. **本地 Supabase 栈是共用的,当心数据互相污染**:
   - agent 跑成共用栈上的一个 edge function,**同一时刻只有一套配置**(`MODEL_PROVIDER` 与本地 JWT 校验配置,在 `supabase/.env`);几个 worktree 不能各跑各的 agent 配置。
   - `supabase/.env` 是 gitignored 文件,git worktree 不会自动复制;主工作区的这份文件是日常 dev 的模型 secret 来源。
   - 别在其它 worktree 可能正在测试时跑 `supabase db reset` 或写库的测试——会冲掉对方的数据;改动 migration 也要顾及共用方。
   - 日常开发默认走 Supabase anonymous auth:登录页点「先随便逛逛」创建 anonymous user,agent 照常校验 JWT,数据写进本地 Supabase 数据库。`pnpm dev:*` / `dx up` / `env:sync` 会从 `supabase/.env` 删掉 `STORE` / `DEV_NO_AUTH` 以**强制**走这条路径(见 [ADR-0009](docs/adr/0009-dev-uses-anonymous-auth.md))。只试 UI、不要持久化时,别走 dev 脚本——用自备 env-file 手动 `supabase functions serve agent --env-file <file>`(含 `STORE=memory`、`DEV_NO_AUTH=1`),客户端再设 `EXPO_PUBLIC_DEV_NO_AUTH=1`。
   - 真要隔离数据库 / 跑 E2E,用 `pnpm e2e:stack up` 起每 worktree 一套独立栈(重,取舍见 [docs/worktree-dev.md](docs/worktree-dev.md))。

> 一句话:在多 worktree 的机器上,跑任何模拟或自动化测试前先想「端口 / 模拟器 / 数据库会不会和别人撞」,默认走 `pnpm dev:*` 脚本。
