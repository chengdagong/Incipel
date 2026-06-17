# Agent 运行时:Hono 编写、v1 部署 Supabase Edge Function、传输用 SSE

Agent 运行时用可移植的 HTTP 框架 Hono 编写,同一份代码可跑在 Supabase Edge Function(Deno)与专用主机(Cloud Run / Fly / Node)上。v1 部署到 Edge Function——与 Supabase 同处、闲时缩到零、不另起一套基础设施。客户端与 agent 之间用 SSE:每轮是一个 run,客户端 POST 发消息、服务端 SSE 流式回 AG-UI 事件;turn-based 的交互不需要 WebSocket 的长连双向。

之所以敢 Edge-first:agent 无状态(状态在 Postgres 与 AG-UI 快照里),且 Hono 让部署目标可换,所以「以后迁专用主机」是改部署目标、不是重写。迁移触发条件写明确:单轮时长逼近 Edge Function 的响应 / CPU 上限,或并发与冷启动开始伤体验。
