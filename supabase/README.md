# supabase/ — 数据层

「织幕」(Incipel)的数据层:Postgres 表结构、Row Level Security 策略、原子落库函数 `save_turn`,以及本地开发配置。计算层(agent 运行时)与此分离 —— 这里只做数据层,不承载 agent(见系统设计 §4)。

```
config.toml              本地开发配置(端口、auth、storage 等)
migrations/0001_init.sql 建表 + RLS + save_turn 函数
```

数据模型见 [`docs/system-design.md`](../docs/system-design.md) §8;模型改剧本的契约见 [`docs/adr/0001`](../docs/adr/0001-screenplay-mutation-contract.md)。

## 本地开发

需要 [Supabase CLI](https://supabase.com/docs/guides/local-development) 与 Docker。命令在仓库根目录执行(CLI 会自动定位 `supabase/`)。

```bash
# 启动本地 Supabase(Postgres / Auth / Storage / Studio / Edge Runtime)
supabase start

# 重建本地库并重跑全部 migration(开发期改 schema 后用)
supabase db reset
```

本项目刻意用 **5452x** 端口段(而非 Supabase 默认 5432x),以便与本机其他本地
Supabase 栈共存、互不抢端口(端口定义见 [`config.toml`](./config.toml))。
`supabase start` 会打印本地 URL 与密钥:

- API URL:`http://127.0.0.1:54521`
- Postgres:`127.0.0.1:54522`
- Studio:`http://127.0.0.1:54523`
- Inbucket(本地收发邮件):`http://127.0.0.1:54524`
- `anon key` / `service_role key`:从输出读取

> 改了 `config.toml` 的端口,记得同步 `packages/agent/.env` 的 `SUPABASE_URL`
> 与 `apps/mobile/.env` 的 `EXPO_PUBLIC_SUPABASE_URL`。

## 应用到远端项目

```bash
# 关联远端项目(一次性,project-ref 取自 Supabase Dashboard 的项目设置)
supabase link --project-ref <project-ref>

# 把本地 migration 推到远端
supabase db push
```

## 启用匿名登录

v1 默认匿名账号(零摩擦入门,事后可选升级,见系统设计 §15/§16)。

- **本地**:已在 [`config.toml`](./config.toml) 的 `[auth]` 下设 `enable_anonymous_sign_ins = true`,`supabase start` 即生效。
- **远端**:在 Supabase Dashboard → Authentication → Sign In / Providers → 打开 **Anonymous Sign-ins**。该项不随 `db push` 同步,需在 Dashboard(或项目的 Management API)单独开启。

客户端用 `supabase.auth.signInAnonymously()` 拿到匿名 JWT;之后绑定邮箱/第三方即升级为正式账号,数据继续归属同一用户。

## RLS 与归属隔离

四张表都开了 Row Level Security,按 `user_id` 隔离:

- `sessions`:直接 `user_id = auth.uid()`;
- `documents` / `document_versions` / `messages`:经 `session_id` 关联到 `sessions.user_id`。

权限按最小授予,且遵循「agent 是权威数据唯一写入方」的边界(见系统设计 §4):

- **客户端**(`authenticated`,含匿名登录):只**读**自己的 `sessions` / `documents`(history 列表、works 内嵌读 `documents.state`);可**删除**自己的会话(删除经外键 `on delete cascade` 连带清子表);并可**收藏**——即对自己 `sessions` 行的 `starred` 一列做**列级** update(见 migration 0003,只放开 `starred`,改不了 `title` / `accent` / `updated_at` 等)。对 `documents` / `messages` / `document_versions` **没有任何写权限** —— 这三张表的写入一律经 agent 走 `save_turn`,否则用户持公开 anon key 即可绕过服务端校验直接篡改自己的剧本与历史。
- **agent**(`service_role`):四张表全部 DML,带 `BYPASSRLS`,落库前已自行校验客户端 JWT 与会话归属。
- **`save_turn`**:`security definer`(以属主身份执行、绕过 RLS),`EXECUTE` 已从 `PUBLIC` 收回、只授予 `service_role` —— 否则任何登录用户都能经 PostgREST 的 `rpc/save_turn` 跨会话(含他人会话)写入。

## save_turn(跨包契约)

一轮结束时,agent 通过 `supabase.rpc('save_turn', …)` 在一个语句内原子落库。参数名/顺序/语义与 agent 的 `src/store.ts` 调用严格一致:

```
save_turn(
  p_session_id uuid, p_user_text text, p_assistant_text text,
  p_deltas jsonb, p_options jsonb, p_state jsonb, p_changed boolean
) returns void
```

行为:

1. `p_user_text` 非空时插入一条 `user` 消息;
2. 插入一条 `assistant` 消息(`text` + 本轮 `deltas` + `options`);
3. 更新 `documents.state = p_state`、`sessions.updated_at = now()`;
4. `p_changed` 为真时,插入一条 `document_versions`(`turn_index` = 该会话当前最大值 + 1)。

函数是 `security definer`,`search_path` 锁死为 `public`。

## agent 所需环境变量

agent 运行时(非本目录,放在 `packages/agent`)需要以下变量读写数据层。**模型密钥只在 agent 这一侧,客户端绝不持有。**

| 变量 | 说明 |
|---|---|
| `SUPABASE_URL` | 项目 API URL(本地为 `http://127.0.0.1:54521`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 密钥;agent 用它绕过 RLS 落库,**绝不下发到客户端** |
| `SUPABASE_JWT_SECRET` | 校验 HS256 客户端 JWT 用;本地开发由 `tools/incipel-dev` 写入 `INCIPEL_SUPABASE_JWT_SECRET`,避免在 env-file 中写 `SUPABASE_` 前缀变量 |

本地 edge runtime 还会读取 `INCIPEL_SUPABASE_JWT_ISS` / `INCIPEL_SUPABASE_JWT_AUD`,用于校验 anonymous auth 产生的 JWT。远端项目通常不需要这些变量。

客户端(`apps/mobile`)只需公开的 `SUPABASE_URL` 与 `anon key`。

## 不预置示例数据

本目录**不含任何 seed / 示例会话 / 假剧本**。原型曾用「按阶段生成假剧本」的离线引擎做断网演示,生产版已删除 —— 不编造内容,生成必须经真实模型联网(见系统设计 §11)。因此没有 `seed.sql`,`supabase db reset` 后是一个干净的空库,所有数据来自真实创作。
