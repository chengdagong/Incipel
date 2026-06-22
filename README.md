# 编剧助手「织幕」(Incipel)

AI 原生的编剧助手:一条流式对话持续沉淀出一份结构化剧本。

- 系统设计:[`docs/system-design.md`](docs/system-design.md)
- 术语表:[`CONTEXT.md`](CONTEXT.md)
- 关键决策:[`docs/adr/`](docs/adr/)
- Apple 登录后台配置:[`docs/apple-sign-in-setup.md`](docs/apple-sign-in-setup.md)

## Monorepo 结构

```
packages/shared   @incipel/shared — 类型、AG-UI 事件、工具 schema(契约源头)
packages/agent    @incipel/agent  — Hono app(AG-UI SSE / 鉴权 / 模型抽象 / tool use 编排),运行时无关
apps/mobile       Expo 客户端(React Native + CopilotKit headless hooks)
supabase/         Postgres migration + RLS + 本地配置;agent 的 Edge Function 在 functions/agent
tools/incipel-dev 开发命令行工具(起栈 / serve agent / 隔离 E2E 栈,见 ADR-0007)
```

数据层(Supabase)与计算层(agent)分开;agent 作为 Supabase Edge Function 部署(见 [ADR-0007](docs/adr/0007-edge-only-agent-runtime.md))。模型密钥只放在 agent 的环境变量里,**客户端绝不持有**(见系统设计 §4)。

## 本地开发

需要 Node ≥ 20、pnpm、Supabase CLI(含 Docker)、Expo CLI。

```bash
pnpm install

# 本地 Supabase + 应用 migration
supabase start
supabase db reset

# Agent(共用栈上的 edge function:起栈 + 同步 env + serve)
pnpm dev:agent

# 客户端
pnpm mobile:start
```

> 骨架阶段:文件树、配置与契约源码已就位,逻辑体多为 TODO。依赖未安装、云端 Supabase 项目未创建——按需自行执行。
