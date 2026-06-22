// Supabase Edge Function:agent 运行时(Deno)。
//
// 这是 ADR-0002 里「v1 部署 Supabase Edge Function」的落地入口。它不重写 agent——应用本身
// (路由 / 鉴权 / SSE 编排)仍是 packages/agent/src/app.ts 那一份可移植 Hono app,这里只是
// 换一个部署目标:用 Deno 原生的 `Deno.serve` 托管,环境变量经 app 内的 env() 读 Deno.env。
//
// 路径前缀:对外是 `https://<project-ref>.supabase.co/functions/v1/agent/…`,网关把请求以
// `/agent/…` 交给运行时,故这里用 createApp('/agent') 让路由前缀对齐(/agent/run、/agent/logline)。
//
// 依赖解析:同目录 deno.json 把 npm 依赖映射到锁定版本的 npm: specifier,把 @incipel/shared
// 映射到 packages/shared/src/index.deno.ts。agent/src 内部相对 import 已写显式 .ts 扩展名。
//
// 鉴权:网关层对本函数关闭 verify_jwt(见 supabase/config.toml [functions.agent]),鉴权完全
// 由 app 内的 authenticate() 负责——它更严(校验 iss/aud/sub),且与「agent 是唯一鉴权处」的
// 设计一致(见 auth.ts、system-design §4)。如此 /health 也可不带 token 探活。
//
// 所需 secret(supabase secrets set;SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWKS
// 由平台自动注入,无需手设):ANTHROPIC_API_KEY,以及可选的 MODEL_PROVIDER / TURN_MODEL /
// LOGLINE_MODEL / OPENROUTER_API_KEY / OPENROUTER_MODEL。

import { createApp } from '../../../packages/agent/src/app.ts';

const app = createApp('/agent');

Deno.serve(app.fetch);
