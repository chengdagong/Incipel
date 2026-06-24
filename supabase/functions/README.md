# supabase/functions/ — 历史 Edge Function 入口

agent 当前运行时是 `packages/agent` 中的 Mastra Node agent server。Supabase 仍负责数据库、Auth、Storage,但本目录不再是受支持的 agent 部署入口。

```
agent/
  index.ts    历史 Deno 入口:Deno.serve(createApp('/agent').fetch)
  deno.json   历史依赖映射
```

## 当前入口

- 本地前台运行:`pnpm dev:agent`
- 本地后台运行:`pnpm dx up`
- 停止当前 worktree 的后台 agent:`pnpm dx agent stop`
- Node server 入口:`packages/agent/src/index.ts`
- Hono app:`packages/agent/src/app.ts`

`pnpm dev:ios` / `pnpm dev:android` 只同步 env、启动 Metro 并打开目标设备;它们不检查也不启动 agent server。

客户端的 `EXPO_PUBLIC_AGENT_URL` 应指向 Node agent server 的 base URL,例如 `http://127.0.0.1:<agent-port>`。客户端会在其后追加 `/run`、`/logline`。

## Secret

模型密钥只放在 agent server 的环境变量里,客户端绝不持有。日常本地开发由 `tools/incipel-dev` 写入 `supabase/.env`:

| 变量 | 说明 |
|---|---|
| `MODEL_PROVIDER` | `openrouter` 或 `stub` |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `SUPABASE_URL` | 本地或远端 Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server 侧写入数据库所需的 service role key |
| `AGENT_PORT` | 本地 agent server 端口 |
| `INCIPEL_SUPABASE_JWT_ISS` / `AUD` / `SECRET` | 本地 JWT 校验覆盖项 |

模型 id、`temperature`、reasoning 开关和 token 预算集中在 `packages/agent/model.config.json`。

## 历史文件

`agent/index.ts` 与 `agent/deno.json` 暂时保留,用于说明旧部署方式和必要时对照迁移。不要再用 `supabase functions deploy agent` 发布新的 agent runtime;新增能力应进入 `packages/agent` 的 Mastra Node server。
