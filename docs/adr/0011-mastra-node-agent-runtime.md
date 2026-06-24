# Mastra Node agent server 作为 agent runtime

> Status: accepted ·
> 取代 [ADR-0008](0008-edge-only-agent-runtime.md) 中“Edge 是 agent 唯一运行时”的决定,并修订 [ADR-0002](0002-agent-runtime-hono-edge-sse.md) 的部署目标。

## 背景

Incipel 的 agent 需要长程对话、tool use、未来的 skill / hook / subagent 机制,并要继续向移动端输出现有 AG-UI SSE 事件。Supabase Edge Function 适合轻量 HTTP 入口,但对长轮流式 agent、依赖图、运行时调试和本地多 worktree 并行开发都不够顺手。

Mastra 提供 TypeScript agent abstraction、tool 注册、streaming chunk、模型网关和运行时 hook。CopilotKit / AG-UI 仍作为前端协议和事件格式存在,不把前端协议交给 Mastra 接管。

## 决定

- agent runtime 改为 `packages/agent/src/index.ts` 启动的 Mastra Node agent server。
- `packages/agent/src/app.ts` 继续负责 Hono 路由、鉴权、AG-UI SSE 编排和 SupabaseStore。
- `packages/agent/src/model/mastra.ts` 负责把 Incipel 的 prompt/tool contract 映射到 Mastra `Agent` 和 `createTool`。
- 移动端 `EXPO_PUBLIC_AGENT_URL` 指向 Node agent server base URL,例如 `http://127.0.0.1:<agent-port>`。
- Supabase 继续负责数据库、Auth、Storage,不再承载 agent runtime。
- `supabase/functions/agent` 仅作为历史入口保留,不再部署新的 agent runtime。

## 后果

- 本地开发重新获得每 worktree 独立 agent server 端口,但仍共用一套 Supabase 栈。
- `tools/incipel-dev` 同步 `apps/mobile/.env` 与 `supabase/.env`,并后台启动 `pnpm --filter @incipel/agent dev`。
- Android 开发脚本需要同时 `adb reverse` Supabase API 端口和 agent server 端口。
- 部署方式从 Supabase Function 部署改为 Node server 部署;具体目标主机可另行选择。
- AG-UI 事件、authentication、Supabase 数据模型继续由 Incipel 代码控制,避免把产品协议绑定到某个 agent framework。

## 没选

- **继续用 Supabase Edge Function 承载 agent**:依赖图和长轮调试成本高,也不利于未来的 hook / subagent 机制。
- **让 Mastra 直接接管前端协议**:移动端已经围绕 AG-UI SSE 工作,保留现有协议能减少迁移面。
- **同时维护 Edge 与 Node 两个生产 runtime**:会增加依赖、secret、健康检查和部署文档的维护成本。
