# Mastra application + Hono server adapter 作为 agent runtime

> Status: accepted ·
> 取代 [ADR-0008](0008-edge-only-agent-runtime.md) 中“Edge 是 agent 唯一运行时”的决定,并修订 [ADR-0002](0002-agent-runtime-hono-edge-sse.md) 的部署目标。

## 背景

Incipel 的 agent 需要长程对话、tool use、未来的 skill / hook / subagent 机制,并要继续向移动端输出现有 AG-UI SSE 事件。Supabase Edge Function 适合轻量 HTTP 入口,但对长轮流式 agent、依赖图、运行时调试和本地多 worktree 并行开发都不够方便。

Mastra 提供 TypeScript agent abstraction、tool 注册、streaming chunk、模型网关和运行时 hook。CopilotKit / AG-UI 仍作为前端协议和事件格式存在,不把前端协议交给 Mastra 接管。

## 决定

- agent runtime 改为 `packages/agent/src/mastra/index.ts` 定义的 Mastra application;Agent 定义放在 `packages/agent/src/mastra/agents/`,Mastra tool wrappers 放在 `packages/agent/src/mastra/tools/`。
- Mastra application 注册生产用 `screenwriter` / `logline` agent,以及 Mastra Studio 调试用 `studio-screenwriter` / `mckee-story-critic` agent,不通过 Mastra `server.apiRoutes` 承载公开的 AG-UI HTTP routes。
- `screenwriter` 与 `studio-screenwriter` 通过 Mastra agent-level `skills` 配置加载 `packages/agent/skills/screenwriting-master`,该目录来自 [Shanyin-ai/shanyin-screenwriting-master](https://github.com/Shanyin-ai/shanyin-screenwriting-master) 的 `.skill` 包;`mckee-story-critic` 与 `logline` agent 不加载该 skill,其中 `logline` 继续只生成一句 logline。
- `packages/agent/src/index.ts` 创建 Hono app,先直接注册 `/run`、`/logline` 和 `/health`,再交给 `@mastra/hono` 的 `MastraServer` 初始化,最后由 `@hono/node-server` 启动 HTTP 服务。
- `packages/agent/src/routes.ts` 负责 Hono route handlers、Supabase JWT 校验、AG-UI SSE 编排和 SupabaseStore。公开 routes 直接挂在外层 Hono app 上,以便请求体上限在读取 JSON 前生效。`packages/agent/src/app.ts` 仅保留给 `app.request()` 测试使用的 Hono wrapper。
- `packages/agent/src/model/mastra.ts` 不再即时创建 `Agent`;它从 Mastra application registry 获取已注册的 `screenwriter` / `logline` agents,再把 Incipel 的 prompt/tool contract 映射到 Mastra `Agent.stream()`、server-side `toolsets` 和 `createTool()`。`request_mckee_story_critique` 作为内部评论 tool 请求 `mckee-story-critic`;Mastra skill 工具调用只供 agent 内部读取 skill;向 AG-UI 转发时只保留本轮剧本工具调用。
- 移动端默认用 `EXPO_PUBLIC_AGENT_URL` 指向 Mastra application agent server base URL;日常 dev 默认为 `http://127.0.0.1:4111`,`pnpm dev:agent` 若经用户确认改用下一个可用端口,会把所选端口保存到 `.worktree-dev.env`,后续 env sync 会继续写入该端口;E2E release runner 构建时临时改成 worktree 相关测试端口。Expo Go / development build 可在设置页用 AsyncStorage 保存开发用 Agent 地址;release build 隐藏该设置,只使用构建时写入的 URL。
- Supabase 继续负责数据库、Auth、Storage,不再承载 agent runtime。
- `supabase/functions/agent` 仅作为历史入口保留,不再部署新的 agent runtime。
- Mastra 自身配置本地 libSQL storage,用于 Mastra Studio 的 message history 与 framework 内部状态;`studio-screenwriter` 配置 Mastra `Memory`,使 Studio 聊天记录写入 `packages/agent/.mastra-studio.db`。产品数据仍由 Incipel 的 Supabase Store 读写。

## 后果

- 本地日常开发默认使用 agent server 端口 `4111`;`pnpm dev:agent` 发现该端口被占用时会询问是否改用下一个可用端口,并保存到 `.worktree-dev.env`。E2E 使用 worktree 相关 agent server 端口,避免占用日常 dev agent。
- `tools/incipel-dev env sync` 同步 `apps/mobile/.env` 与 `supabase/.env`;移动端开发脚本只调用它,不检查也不启动 agent server。
- 需要 agent server 时,使用 `pnpm dev:agent` 前台启动;需要后台 agent server 时,手动使用 `pnpm dx up`。
- Android 开发脚本需要同时 `adb reverse` Supabase API 端口和 `apps/mobile/.env` 中的 agent server 端口;这只是端口转发,不代表 agent server 已运行。
- 部署方式从 Supabase Function 部署改为 Node server 部署;具体目标主机可另行选择。
- AG-UI 事件、authentication、Supabase 数据模型继续由 Incipel 代码控制,避免把产品协议绑定到某个 agent framework。

## 没选

- **继续用 Supabase Edge Function 承载 agent**:依赖图和长轮调试成本高,也不利于未来的 hook / subagent 机制。
- **让 Mastra 直接接管前端协议**:移动端已经围绕 AG-UI SSE 工作,保留现有协议能保留已验证的移动端行为。
- **同时维护 Edge 与 Node 两个生产 runtime**:会增加依赖、secret、健康检查和部署文档的维护成本。
