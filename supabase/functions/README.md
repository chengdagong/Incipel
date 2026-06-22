# supabase/functions/ — Edge Functions

「织幕」(Incipel)的计算层(agent 运行时)以 Supabase Edge Function(Deno)部署,与数据层同处、闲时缩到零(见 [ADR-0002](../../docs/adr/0002-agent-runtime-hono-edge-sse.md))。

```
agent/
  index.ts    Deno 入口:Deno.serve(createApp('/agent').fetch)
  deno.json   依赖映射(npm: 版本与 pnpm-lock 锁定一致;@incipel/shared 指向 index.deno.ts)
```

## 唯一运行时:Edge Function

agent 的应用本身(路由 / 鉴权 / SSE 编排)在 `packages/agent/src/app.ts` 的 `createApp(basePath)`,运行时无关;唯一受支持的运行时是 Supabase Edge Function(见 [ADR-0008](../../docs/adr/0008-edge-only-agent-runtime.md))。

- **Edge 入口**(本目录):`Deno.serve(createApp('/agent').fetch)`。Supabase 网关把 `/functions/v1/agent/…` 以 `/agent/…` 交给运行时,故路由加 `/agent` 前缀。
- 环境变量经 `app` 内的 `env()` 读取(先 `Deno.env`,再 `process.env`)。
- `createApp` 仍运行时无关:真撞 Edge 时长 / CPU 上限需迁专用主机时,加回一个 ~30 行的 Node 入口 + `@hono/node-server` 即可(休眠可恢复的退路,见 ADR-0008 / [ADR-0002](../../docs/adr/0002-agent-runtime-hono-edge-sse.md))。

> 跨运行时模块解析:agent 源码内部相对 import 写显式 `.ts` 扩展名;`@incipel/shared` 经 `deno.json` 映射到 `packages/shared/src/index.deno.ts`(显式 `.ts` re-export)。客户端(Metro)与 Node 测试仍走无扩展名的 `index.ts`。如此不依赖 Deno 的 unstable `sloppy-imports`,部署稳定。

## 鉴权

网关层对本函数关闭 `verify_jwt`(见 [`../config.toml`](../config.toml) 的 `[functions.agent]`)。鉴权完全由函数内的 `authenticate()` 负责——它更严(校验 `iss` / `aud` / `sub`),与「agent 是唯一鉴权处」的设计一致(见 `packages/agent/src/auth.ts`、系统设计 §4)。如此 `/agent/health` 也能不带 token 探活。

客户端照常发 `Authorization: Bearer <Supabase JWT>`(匿名或正式),函数据此校验归属。

## Secret

Edge 上由平台**自动注入**、无需也不能手设(平台禁止设 `SUPABASE_` 前缀的自定义 secret):

- `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_JWKS`

需要**手动**设的(模型密钥只在服务端):

| Secret | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | 默认 provider 的 key(`MODEL_PROVIDER=anthropic` 时必需) |
| `MODEL_PROVIDER` | `anthropic`(默认)或 `openrouter` |
| `TURN_MODEL` / `LOGLINE_MODEL` | 可选,覆盖每轮 / logline 的模型 id |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | 仅 `MODEL_PROVIDER=openrouter` 时需要 |

校验客户端 JWT 默认走非对称签名 + JWKS(端点由 `SUPABASE_URL` 推出),故 Edge 上**不必**设 `SUPABASE_JWT_SECRET`(仅旧项目用对称 HS256 签名时才需要)。

本地 `supabase functions serve --env-file supabase/.env` 使用 `tools/incipel-dev` 写入的 `INCIPEL_SUPABASE_JWT_ISS` / `INCIPEL_SUPABASE_JWT_AUD` / `INCIPEL_SUPABASE_JWT_SECRET`,让本地 anonymous auth 的 JWT 能按浏览器看到的 issuer 校验。远端项目不需要这些 `INCIPEL_*` 变量。

```bash
# 一次性把模型密钥写进远端项目的 secrets(也可用 --env-file)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... MODEL_PROVIDER=anthropic --project-ref <project-ref>
```

## 本地运行(Deno)

本地栈是多 worktree **共用**的(见仓库根 `CLAUDE.md`):`supabase functions serve` 会占用机器级资源,跑前先确认不与其它 worktree 撞车。

本地 `supabase start` **不会**自动 serve 函数,必须另跑 `supabase functions serve`。这件事已封进 CLI:

```bash
pnpm dev:agent     # 前台:起共用栈(若未起)+ 同步 env + serve agent(看热重载日志用)
pnpm dx up         # 后台:同上,但 serve 走 detached 不阻塞(pnpm dev:ios / dev:android 会自动调它)
# 访问:http://127.0.0.1:54521/functions/v1/agent/health

# 或全手动:
supabase start
supabase functions serve agent --env-file supabase/.env --no-verify-jwt
```

> `pnpm dev:ios` / `dev:android` 起 Metro 前会自动 `up`(起栈 + 后台 serve agent),所以平时跑客户端一条命令就够;设 `INCIPEL_SKIP_AGENT=1` 可跳过。`up` 已在 serve 且 `supabase/.env` 未变化时(探 `/health`)不会重复启动;若 `up` 实际改动了 `supabase/.env`,会重启后台 Edge Runtime,让新环境变量生效。

> 日常共用 dev 走 Supabase anonymous auth:登录页点「先随便逛逛」后取得 session,agent 校验 JWT 并写入本地 Supabase 数据库。要隔离数据 / 跑 E2E 时用 `pnpm e2e:stack up` 起一套独立栈(见 [docs/worktree-dev.md](../../docs/worktree-dev.md))。

## 部署到远端

```bash
supabase link --project-ref <project-ref>   # 一次性
supabase functions deploy agent --use-api
```

部署不需要 GitHub remote;但需先 `link` 到远端项目,并已 `supabase secrets set` 好模型密钥。部署后把客户端 `EXPO_PUBLIC_AGENT_URL` 指到 `https://<project-ref>.supabase.co/functions/v1/agent`。

> 依赖版本由 `deno.json` 精确锁定;`deno.lock` 按本机 Deno 版本生成、刻意不入库(见 `.gitignore`),交由 Supabase 在部署时解析,避免 Deno 版本差异触发 lockfile 完整性报错。
