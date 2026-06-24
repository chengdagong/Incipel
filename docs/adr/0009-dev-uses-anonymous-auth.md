# 本地开发默认使用匿名登录,不跳过身份校验

> Status: accepted ·
> 修订 [ADR-0008](0008-edge-only-agent-runtime.md) 中“本地 dev 用 `DEV_NO_AUTH` 跳过鉴权”的决定。延续 [ADR-0005](0005-auth-entry-in-v1.md) 中“登录页是入口,「先随便逛逛」走匿名登录”的产品决定。

## 背景

开发环境原本为了绕过本地 agent runtime 中 `SUPABASE_URL` 与客户端 JWT `iss` 不一致的问题,默认设置:

- 客户端 `EXPO_PUBLIC_DEV_NO_AUTH=1`,直接跳过登录页;
- agent `DEV_NO_AUTH=1`,不校验 JWT,使用固定 `dev-user`;
- agent `STORE=memory`,数据只存在进程内存里。

这个路径能快速看 UI 和 agent 对话,但它不是产品里的“先随便逛逛”。产品里的匿名入口应创建一个 anonymous user,拿到 Supabase session,再让 agent 用该 JWT 校验身份并把会话数据保存到 Supabase 数据库。Supabase 官方文档也明确说明:调用 `signInAnonymously()` 会创建 anonymous user;anonymous user 与正式用户一样使用 `authenticated` Postgres role,JWT 中可带 `is_anonymous` claim。

## 决定

- **本地日常开发默认走 Supabase anonymous auth。** 无 session 时显示登录页;点击「先随便逛逛」调用 `supabase.auth.signInAnonymously()`;成功后客户端持有 Supabase session。
- **agent 本地开发默认照常校验 JWT。** `DEV_NO_AUTH` 不再由开发 CLI 默认写入;agent 使用 `SupabaseStore`,通过 `service_role` 写入数据库,并在写入前用客户端 JWT 确认用户身份。
- **本地 JWT 校验使用项目自有环境变量补齐。** `tools/incipel-dev` 从 `supabase status -o json` 读取本地 API URL、anon key 与 JWT secret,写入:
  - `apps/mobile/.env`: `EXPO_PUBLIC_SUPABASE_URL`、`EXPO_PUBLIC_SUPABASE_ANON_KEY`、`EXPO_PUBLIC_AGENT_URL`;
  - `supabase/.env`: `INCIPEL_SUPABASE_JWT_ISS`、`INCIPEL_SUPABASE_JWT_AUD`、`INCIPEL_SUPABASE_JWT_SECRET`。
- **`DEV_NO_AUTH` / `STORE=memory` 只保留为显式调试模式,且不经 dev 脚本提供。** `pnpm dev:*` / `dx up` / `env:sync` 会从 `supabase/.env` **移除**这两项,以强制 dev 走 Supabase backend + anonymous auth(实现见 `tools/incipel-dev` 的 envSync)。要用 memory / 免鉴权,得绕开 dev 脚本——自己用自备 env-file 启动 `pnpm --filter @incipel/agent start`(单元测试则在 vitest 进程内设 env)。启用后不应期待数据保存到 Supabase 数据库。

## 后果

- 开发时点击「先随便逛逛」会创建本地 Supabase anonymous user,作品和会话历史会进入共用本地数据库。
- 多个 worktree 共用同一套本地 Supabase 数据库时,匿名用户和会话数据也共享同一个数据层。需要隔离数据时使用 `pnpm e2e:stack up`。
- `apps/mobile/.env` 里的 anon key 不应再长期停留在占位值;`pnpm dev:*` / `pnpm dx up` / `pnpm env:sync` 会按当前本地栈刷新它。
- 若只想试界面且不想写入数据库:客户端设 `EXPO_PUBLIC_DEV_NO_AUTH=1`,agent 侧用一个**自备的** env-file 跑 `pnpm --filter @incipel/agent start`(内含 `DEV_NO_AUTH=1`、`STORE=memory`、`AGENT_PORT=<port>`)——**不要**走 `pnpm dev:*`,它会把这两项从 `supabase/.env` 删掉(强制 anonymous auth)。这条路径不写数据库,也不等同产品里的匿名登录。
