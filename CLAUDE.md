# Incipel — 给 Claude 的项目须知

AI 原生编剧助手「织幕」。项目背景见 [README.md](README.md),领域术语见 [CONTEXT.md](CONTEXT.md),
关键决策见 [docs/adr/](docs/adr/)。本文件只放与日常操作相关、容易出错的约定。

## 并行 worktree:跑模拟器 / 服务 / 自动化测试前必读

同一台机器上可能有多个 git worktree 同时在开发或测试。模拟器、开发服务、本地 Supabase
都占用机器级的独占资源,**直接照 README「本地开发」里的裸命令跑会与其它 worktree 撞车**:

- Metro 端口 `8081`(固定;我们总是只跑一个 dev 环境,不再为每个 worktree 错开,见 [docs/worktree-dev.md](docs/worktree-dev.md))
- iOS simulator(`pnpm dev:ios` 固定使用机器级共享实例 `incipel-development`;Expo CLI 默认指向「最近打开的那台」,多 simulator 时会打错)
- Android 模拟器 / 设备(多设备在线时需要显式指定 serial)
- 本地 Supabase 栈(CLI 按 `project_id` 归一,多个 worktree **共用同一套**数据库 / auth / storage;日常 Mastra agent server 默认使用端口 `4111`,`pnpm dev:agent` 发现该端口被占用时会询问是否改用下一个可用端口,并把用户确认的端口保存到 `.worktree-dev.env`;E2E 才使用 worktree 相关端口)

因此在本仓库:

1. **起开发服务或模拟器,用 worktree 感知的脚本,不要用裸命令**:
   - `pnpm dev:ios` —— Metro 固定 8081 + 共享 iOS simulator `incipel-development`(按 UDID 定向);起 Metro 前会自动起共用 Supabase 栈并写好 env,但不启动、不检查 agent
   - `pnpm dev:android` —— Metro 固定 8081 + 显式指定的 Android 设备 / 模拟器(按 serial 定向);起 Metro 前会自动起共用 Supabase 栈并写好 env,但不启动、不检查 agent
   - `pnpm dev:agent` —— **前台**起共用栈并启动 agent server(需要 agent 或想看 agent 日志时用;日常 dev agent 端口默认是 `4111`,若被占用会询问是否改用下一个可用端口,并保存到 `.worktree-dev.env`,见 [ADR-0011](docs/adr/0011-mastra-node-agent-runtime.md))
   - `pnpm dx up` —— **后台**启动当前 worktree 的 agent server 和 watcher;仅在明确需要后台 agent 时用
   - `pnpm dx agent stop` —— 停止当前 worktree 元数据记录的后台 agent watcher / server;不停止本地 Supabase 数据库、auth、storage 等其它容器
   两个客户端脚本用固定的 Metro 8081(+ 本 worktree 独立的 Metro 缓存),并把 `apps/mobile/.env` 与 `supabase/.env` 写好。`pnpm dev:ios` 在任一 worktree 中都打开同一个 `incipel-development` simulator;`pnpm e2e:ios` 仍使用 worktree 专属 simulator。新 worktree 第一次需要 `supabase/.env` 时,`tools/incipel-dev` 必须先从主工作区完整复制该文件,再写本地 JWT 校验变量。机制与取舍见 [docs/worktree-dev.md](docs/worktree-dev.md)。

2. **跑会启动模拟器或长驻服务的自动化测试前**,先确认模拟器 / 共用栈不会和别处冲突:
   走上面的脚本,或显式指定设备(`expo run:ios --device <UDID>`、`adb -s <serial>`)。
   Metro 固定 8081、且只跑一个 dev 环境,所以别同时再起一个占 8081 的 Metro;也别假定某台模拟器只有自己在用。

3. **本地 Supabase 栈是共用的,当心数据互相污染**:
   - 日常 dev agent server 默认监听端口 `4111`,端口被占用时 `pnpm dev:agent` 会先询问是否用下一个可用端口启动本次前台 agent,并把确认后的端口写入 `.worktree-dev.env`、`apps/mobile/.env` 与 `supabase/.env`;后续 `env sync` 会继续使用 `.worktree-dev.env` 中的端口。E2E runner 使用 worktree 相关端口,避免占用日常 dev agent。
   - `supabase/.env` 是 gitignored 文件,git worktree 不会自动复制;主工作区的这份文件是日常 dev 的模型 secret 来源。
   - 别在其它 worktree 可能正在测试时跑 `supabase db reset` 或写库的测试——会冲掉对方的数据;改动 migration 也要顾及共用方。
   - 日常开发默认走 Supabase anonymous auth:登录页点「先随便逛逛」创建 anonymous user,agent 照常校验 JWT,数据写进本地 Supabase 数据库。`pnpm dev:*` / `dx up` / `env:sync` 会从 `supabase/.env` 删掉 `STORE` / `DEV_NO_AUTH` 以**强制**走这条路径(见 [ADR-0009](docs/adr/0009-dev-uses-anonymous-auth.md))。只试 UI、不要持久化时,别走 dev 脚本——用自备 env-file 手动 `supabase functions serve agent --env-file <file>`(含 `STORE=memory`、`DEV_NO_AUTH=1`),客户端再设 `EXPO_PUBLIC_DEV_NO_AUTH=1`。
   - 真要隔离数据库 / 跑 E2E,用 `pnpm e2e:stack up` 起每 worktree 一套独立栈(重,取舍见 [docs/worktree-dev.md](docs/worktree-dev.md))。

> 一句话:在多 worktree 的机器上,跑任何模拟或自动化测试前先想「端口 / 模拟器 / 数据库会不会和别人撞」,默认走 `pnpm dev:*` 脚本。
