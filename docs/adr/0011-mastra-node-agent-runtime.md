# Mastra application + Hono server adapter 作为 agent runtime

> Status: accepted ·
> 取代 [ADR-0008](0008-edge-only-agent-runtime.md) 中“Edge 是 agent 唯一运行时”的决定,并修订 [ADR-0002](0002-agent-runtime-hono-edge-sse.md) 的部署目标。

## 背景

Incipel 的 agent 需要长程对话、tool use、未来的 skill / hook / subagent 机制,并要继续向移动端输出现有 AG-UI SSE 事件。Supabase Edge Function 适合轻量 HTTP 入口,但对长轮流式 agent、依赖图、运行时调试和本地多 worktree 并行开发都不够方便。

Mastra 提供 TypeScript agent abstraction、tool 注册、streaming chunk、模型网关和运行时 hook。CopilotKit / AG-UI 仍作为前端协议和事件格式存在,不把前端协议交给 Mastra 接管。

## 决定

- agent runtime 改为 `packages/agent/src/mastra-app.ts` 定义的 Mastra application。
- Mastra application 注册 `screenwriter` 与 `logline` 两个 agent,不通过 Mastra `server.apiRoutes` 承载公开的 AG-UI HTTP routes。
- `packages/agent/src/index.ts` 创建 Hono app,先直接注册 `/run`、`/logline` 和 `/health`,再交给 `@mastra/hono` 的 `MastraServer` 初始化,最后由 `@hono/node-server` 启动 HTTP 服务。
- `packages/agent/src/routes.ts` 负责 Hono route handlers、Supabase JWT 校验、AG-UI SSE 编排和 SupabaseStore。公开 routes 直接挂在外层 Hono app 上,以便请求体上限在读取 JSON 前生效。`packages/agent/src/app.ts` 仅保留给 `app.request()` 测试使用的 Hono wrapper。
- `packages/agent/src/model/mastra.ts` 不再即时创建 `Agent`;它从 Mastra application registry 获取已注册的 `screenwriter` / `logline` agents,再把 Incipel 的 prompt/tool contract 映射到 Mastra `Agent.stream()`、server-side `toolsets` 和 `createTool()`。
- 移动端 `EXPO_PUBLIC_AGENT_URL` 指向 Mastra application agent server base URL,例如 `http://127.0.0.1:<agent-port>`。
- Supabase 继续负责数据库、Auth、Storage,不再承载 agent runtime。
- `supabase/functions/agent` 仅作为历史入口保留,不再部署新的 agent runtime。
- Mastra 自身配置 `InMemoryStore` 仅用于 framework 内部状态;产品数据仍由 Incipel 的 Supabase Store 读写。

## 后果

- 本地开发重新获得每 worktree 独立 agent server 端口,但仍共用一套 Supabase 栈。
- `tools/incipel-dev` 同步 `apps/mobile/.env` 与 `supabase/.env`,并后台启动 `pnpm --filter @incipel/agent dev`。
- Android 开发脚本需要同时 `adb reverse` Supabase API 端口和 agent server 端口。
- 部署方式从 Supabase Function 部署改为 Node server 部署;具体目标主机可另行选择。
- AG-UI 事件、authentication、Supabase 数据模型继续由 Incipel 代码控制,避免把产品协议绑定到某个 agent framework。

## 没选

- **继续用 Supabase Edge Function 承载 agent**:依赖图和长轮调试成本高,也不利于未来的 hook / subagent 机制。
- **让 Mastra 直接接管前端协议**:移动端已经围绕 AG-UI SSE 工作,保留现有协议能保留已验证的移动端行为。
- **同时维护 Edge 与 Node 两个生产 runtime**:会增加依赖、secret、健康检查和部署文档的维护成本。
