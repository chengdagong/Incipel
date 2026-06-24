# Edge 为 agent 唯一运行时:删 Node 入口,本地 dev / E2E 改走 Supabase edge runtime

> Status: superseded by [ADR-0011](0011-mastra-node-agent-runtime.md) ·
> 2026-06-24 起,agent runtime 改为 Mastra Node agent server;本文保留为历史记录。
>
> 部分取代 [ADR-0002](0002-agent-runtime-hono-edge-sse.md):0002 把 agent 写成可跨 Edge 与专用主机(Cloud Run / Fly / Node)的可移植运行时,并以 Node 专用主机作为「迁移退路」;本 ADR 删掉随时可用的 Node 部署入口,只留 Edge 一个运行时。0002 关于「应用本身运行时无关」的设计不变。
> 本文关于“本地 dev 默认 `DEV_NO_AUTH`”的决定已被 [ADR-0009](0009-dev-uses-anonymous-auth.md) 修订:日常开发默认使用 Supabase anonymous auth。

[ADR-0002](0002-agent-runtime-hono-edge-sse.md) 让同一份 Hono app 既能跑 Supabase Edge Function(Deno),也能跑 Node 专用主机;v1 部署 Edge,Node 既是本地开发回路(`pnpm dev:agent`,每 worktree 独立端口、tsx 热重载),也是「Edge 撞上限时迁回专用主机」的现成退路。本 ADR 记录一次有意的收窄:**Edge 成为 agent 唯一受支持的运行时,删除 Node 服务器入口,本地开发与 E2E 都改在 Supabase 的 edge runtime 上跑。**

**决定:**

- **只删 Node 服务器入口,不删逻辑。** 删除 [packages/agent/src/index.ts](../../packages/agent/src/index.ts) 里的 `@hono/node-server` 启动块、`@hono/node-server` 依赖、`dev:agent` / `agent:dev` 脚本、[scripts/dev-agent.sh](../../scripts/dev-agent.sh),以及 [worktree-dev-env.sh](../../scripts/lib/worktree-dev-env.sh) 里分配 `AGENT_PORT`、写 `EXPO_PUBLIC_AGENT_URL=localhost:<port>` 那部分。**保留**运行时无关的 `createApp` 工厂([app.ts](../../packages/agent/src/app.ts))、全部 agent 逻辑、经 `app.request()` 测应用的 vitest、以及 `dev/` 下的冒烟脚本(它们走 tsx、不依赖服务器)。
- **日常本地开发 = 单一共用栈上的一个 edge function。** 配置定为**SupabaseStore + Supabase anonymous auth + 模型 key**(OpenRouter 或 Anthropic)。`SUPABASE_URL` / service key 由本地 edge runtime 自动注入;本地 JWT 的 issuer / audience / HS256 secret 由 [ADR-0009](0009-dev-uses-anonymous-auth.md) 定义的 `INCIPEL_SUPABASE_JWT_*` 环境变量补齐。
- **一份 function 同一时刻只有一套配置。** 共用 edge function 的 `MODEL_PROVIDER` 与本地 JWT 校验配置是全局一套;谁的配置需求不同(要隔离数据、并行 E2E),谁就去起独立栈。每 worktree「自带一个内存版 agent」(旧 [worktree-dev.md](../worktree-dev.md) §选项 2)随 Node 入口一并消失。
- **E2E = 按需起的 per-worktree 隔离栈。** E2E 会真实写入数据库,共用栈上并行会互相影响数据。改为:跑 E2E 时按 worktree 派生 `project_id` 与错开的整段端口,生成一份 gitignored 的 workdir(链入 migrations / seed,复制 functions,在 workdir 根目录链入 packages 供 Edge Function 相对 import 解析),`supabase start --workdir` 起栈 + serve function,跑完 `stop` 拆掉;日常仍只一套共用栈。之所以要文本生成 config:config.toml 的 `env()` 插值只支持字符串,**整数端口改不了**,无法靠环境变量动态错开。
- **配置交给一个轻量 Node CLI。** 新增 `tools/incipel-dev`(依赖极少),子命令大致 `dev`(起共用栈 + serve agent + 写 env)、`e2e up|down`(生成 / 拆隔离 workdir)、`env sync`(写 `EXPO_PUBLIC_*` 与 `supabase/.env`)。它接手 `dev-agent.sh` 与 `worktree-dev-env.sh` 里 agent 相关的职责;选 Node 而非 bash,是因为生成 per-worktree config.toml 涉及 TOML 改写 / 模板 / 符号链接,bash 做这些易错。
- **鉴权边界不变。** 网关层对该 function 关 `verify_jwt`,app 内的 `authenticate()` 为权威(校验 iss / aud / sub);日常本地 dev 也走这条校验路径。

**为什么收到 Edge 一个运行时:**

- 单一规范运行时,去掉「Node 入口 + Edge 入口」双份维护与双套环境变量处理的认知负担。
- 本地开发与生产同构:同样的 Deno edge runtime、同样的依赖解析与 secret 注入,本地能复现的问题更接近线上。
- 可移植性并未真正丢失——`app.ts` 仍运行时无关,删的只是「随时可用且被测试覆盖」的 Node 入口,不是删除跑在别处的能力。

## 推论(留给后来人)

- **退路从「现成可用」降为「休眠可恢复」。** 真撞 Edge 的单轮时长 / CPU / wall-clock 上限时(本 agent 是流式多步轮、`maxSteps=8`、长 SSE,正是 ADR-0002 点名的那种最易撞限负载),重建 Node 目标 ≈ 加回约 30 行 `index.ts` 入口 + `@hono/node-server` 依赖 + 一个 server 冒烟测试,代价不大;但在压力下重建、且这层保险不再被 CI 覆盖,是要接受的风险。监控单轮时长,逼近上限就提前把入口加回来,别等真超。
- **多 worktree 并行 agent 开发退化。** 几个 worktree 不能再各跑各的 agent;共用 edge function 只有一份代码、一套配置在跑。需要隔离的(真鉴权、独立数据、并行 E2E)一律走独立栈。
- **E2E 接 agent 时走隔离栈,不再起 Node agent。** 隔离栈的起拆已由 `tools/incipel-dev e2e up|down` 提供。任何接 agent 的 E2E 层(如以 fake provider 跑真实一轮的层)应指向该隔离栈的 `<api>/functions/v1/agent`、用 `supabase functions serve agent --workdir <workdir> --env-file supabase/.env`(`MODEL_PROVIDER=fake`),而不是起一个 Node agent。注:本分支当前的 Maestro 套件只有 `anon-login`,尚无接 agent 的 E2E 层;此条是给后续补该层的人。
- **本地开发开始依赖 Docker。** 从「tsx 热重载、不碰 Docker」变为「需本地 Supabase 栈 + edge runtime」,启动更重、热重载更慢——这是换取与生产同构的代价。

## 考虑过但没选

- **留 Node 作并行开发的退路**:与「单一规范运行时」的目标冲突,且双入口维护负担是这次想去掉的东西。
- **每 worktree 常驻独立栈**:N 套全套 Docker 容器同时跑,内存与冷启动代价过重;改为 E2E 按需起、跑完拆。
- **共用栈上串行跑 E2E(db reset + 锁)**:最省机器,但无法并行 E2E;隔离栈换来并行与确定性。
