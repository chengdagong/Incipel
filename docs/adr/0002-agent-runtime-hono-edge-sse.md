# Agent 运行时:Hono 编写、v1 部署 Supabase Edge Function、传输用 SSE

> Status: 部分被 [ADR-0007](0007-edge-only-agent-runtime.md) 取代 ·
> 本文「同一份代码也能跑 Node 专用主机、并以 Node 作为现成迁移退路」一节已不再成立:Node 服务器入口被删,Edge 是唯一受支持的运行时。但「应用本身(`createApp`)运行时无关、可移植」的设计仍然有效——退路从「现成可用」降为「休眠可恢复」,细节见 0007。

Agent 运行时用可移植的 HTTP 框架 Hono 编写,同一份代码可跑在 Supabase Edge Function(Deno)与专用主机(Cloud Run / Fly / Node)上。v1 部署到 Edge Function——与 Supabase 同处、闲时缩到零、不另起一套基础设施。客户端与 agent 之间用 SSE:每轮是一个 run,客户端 POST 发消息、服务端 SSE 流式回 AG-UI 事件;turn-based 的交互不需要 WebSocket 的长连双向。

之所以敢 Edge-first:agent 无状态(状态在 Postgres 与 AG-UI 快照里),且 Hono 让部署目标可换,所以「以后迁专用主机」是改部署目标、不是重写。迁移触发条件写明确:单轮时长逼近 Edge Function 的响应 / CPU 上限,或并发与冷启动开始伤体验。

## 实现(2026-06)

「同一份代码、换部署目标」的落地形态:

- **应用与入口分离**。应用本身(路由 / 鉴权 / SSE 编排)收在 `packages/agent/src/app.ts` 的 `createApp(basePath)`,运行时无关、不 import 任何 Node 专属东西。两个入口只挂不同部署目标:
  - Node:`packages/agent/src/index.ts` 用 `@hono/node-server` 起服务,无路由前缀(`/run`、`/logline`)。
  - Edge:`supabase/functions/agent/index.ts` 用 `Deno.serve(createApp('/agent').fetch)`。
- **路由前缀**。Supabase 网关把 `/functions/v1/agent/…` 以 `/agent/…` 交给运行时,故 Edge 用 `createApp('/agent')` 对齐前缀;Node 直连用 `createApp()`(无前缀)。
- **环境变量**。统一经 `env()`(`packages/agent/src/env.ts`)读取,先 `Deno.env`(Edge)后 `process.env`(Node),业务代码不再直接耦合某运行时的全局对象。
- **依赖解析(不依赖 unstable 特性)**。`supabase/functions/agent/deno.json` 把 npm 依赖映射到与 `pnpm-lock.yaml` 锁定一致的 `npm:` 版本;agent 源码内部相对 import 写显式 `.ts` 扩展名;`@incipel/shared` 映射到 `packages/shared/src/index.deno.ts`(显式 `.ts` re-export)。客户端(Metro)与 Node 仍走无扩展名的 `index.ts`。如此**不**依赖 Deno 的 `sloppy-imports`(其在 `supabase functions deploy` 时不稳定),部署可重复。
- **鉴权边界**。网关层对本函数关闭 `verify_jwt`(`supabase/config.toml` 的 `[functions.agent]`),鉴权完全由函数内的 `authenticate()` 负责——它更严(校验 `iss` / `aud` / `sub`),与「agent 是唯一鉴权处」一致(见 system-design §4)。

部署与本地运行见 [`supabase/functions/README.md`](../../supabase/functions/README.md)。
