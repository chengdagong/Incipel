// 校验客户端发来的 Supabase JWT,取出 user_id。
// agent 是唯一调用模型、并以 service role 读写 Postgres 的地方;它必须先确认
// 请求方身份,再把会话限定在该用户(见 system-design §4)。校验失败即抛错,绝不放行。
//
// 两种签名都支持,按 token 头部的 alg 分流:
//   · 非对称(ES256/RS256/EdDSA):Supabase 现默认用 JWT 签名密钥(asymmetric signing
//     keys),公钥经 JWKS 端点(/auth/v1/.well-known/jwks.json)发布;按 kid 取公钥验签。
//   · HS256:旧项目/本地栈用共享 secret 对称签名;作为后备保留。
// 远端与本地一视同仁:JWKS 的地址由 SUPABASE_URL 推出。

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { env } from './env.ts';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export type AuthedUser = {
  userId: string;
  // Supabase 匿名用户与正式用户一视同仁;这里保留 role 仅供日志/审计。
  role?: string;
};

// 接受的非对称算法。Supabase 默认 ES256;RS256/EdDSA 一并放行以兼容其他配置。
const ASYMMETRIC_ALGS = ['ES256', 'RS256', 'EdDSA'];

// 期望的 audience:Supabase 的终端用户 access token(匿名与正式)其 aud 均为 'authenticated'。
// 不据此区分匿名/正式(产品本意是一视同仁),只用它把「非面向终端用户签发」的 token 挡在门外。
const DEFAULT_AUDIENCE = 'authenticated';

// 校验 token 的作用范围(issuer / audience),而不只看签名(见 docs/known-issues.md KI-4)。
// 只校验签名会接受任何用同一密钥材料签出的 token——尤其是 agent 自己持有的 service_role JWT;
// 钉住 iss/aud 后,只有面向本项目终端用户签发的 token 才放行。
//   · issuer:Supabase GoTrue 把 iss 设为 `${SUPABASE_URL}/auth/v1`;可用
//     INCIPEL_SUPABASE_JWT_ISS / SUPABASE_JWT_ISS 覆盖。
//   · audience:默认 'authenticated';可用 INCIPEL_SUPABASE_JWT_AUD / SUPABASE_JWT_AUD 覆盖。
// INCIPEL_* 覆盖项供本地 `supabase functions serve --env-file` 使用:env-file 不适合写
// SUPABASE_ 前缀变量,但本地匿名登录需要把浏览器看到的 issuer 传给 edge runtime。
function expectedClaims(): { issuer: string; audience: string } {
  const audience = env('INCIPEL_SUPABASE_JWT_AUD') || env('SUPABASE_JWT_AUD') || DEFAULT_AUDIENCE;
  const issOverride = env('INCIPEL_SUPABASE_JWT_ISS') || env('SUPABASE_JWT_ISS');
  if (issOverride) return { issuer: issOverride, audience };
  const url = env('SUPABASE_URL');
  if (!url) {
    throw new AuthError('SUPABASE_URL 未配置(校验 JWT issuer 需要)');
  }
  return { issuer: `${url.replace(/\/$/, '')}/auth/v1`, audience };
}

function jwtSecretKey(): Uint8Array {
  const secret = env('INCIPEL_SUPABASE_JWT_SECRET') || env('SUPABASE_JWT_SECRET');
  if (!secret) {
    throw new AuthError('SUPABASE_JWT_SECRET / INCIPEL_SUPABASE_JWT_SECRET 未配置(HS256 校验需要)');
  }
  return new TextEncoder().encode(secret);
}

// 远端 JWKS 取公钥;createRemoteJWKSet 自带缓存与按 kid 拉取(密钥轮换时自动重取)。
// 单例缓存,避免每次请求都新建。
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const url = env('SUPABASE_URL');
  if (!url) {
    throw new AuthError('SUPABASE_URL 未配置(JWKS 校验需要)');
  }
  jwks = createRemoteJWKSet(new URL(`${url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

// 从 Authorization: Bearer <token> 取出裸 token。
export function bearerToken(authorization: string | undefined | null): string {
  if (!authorization) {
    throw new AuthError('缺少 Authorization 头');
  }
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AuthError('Authorization 头格式应为 "Bearer <token>"');
  }
  return token;
}

// 按头部 alg 分流验签:HS256 走共享 secret,其余(非对称)走 JWKS。
export async function verifyJwt(token: string): Promise<AuthedUser> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch (err) {
    throw new AuthError(`JWT 解析失败: ${(err as Error).message}`);
  }

  // 除签名外,一并校验 issuer / audience(见 KI-4);jose 会在不匹配时抛错。
  const { issuer, audience } = expectedClaims();

  let payload: JWTPayload;
  try {
    if (alg === 'HS256') {
      // 旧项目:共享 secret(对称)。
      ({ payload } = await jwtVerify(token, jwtSecretKey(), {
        algorithms: ['HS256'],
        issuer,
        audience,
      }));
    } else {
      // 现默认:JWT 签名密钥(非对称),公钥经 JWKS 按 kid 取。
      ({ payload } = await jwtVerify(token, getJwks(), {
        algorithms: ASYMMETRIC_ALGS,
        issuer,
        audience,
      }));
    }
  } catch (err) {
    throw new AuthError(`JWT 校验失败: ${(err as Error).message}`);
  }

  // Supabase 把用户 id 放在标准的 sub claim。
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub) {
    throw new AuthError('JWT 缺少 sub(user_id)');
  }

  return {
    userId: sub,
    role: typeof payload.role === 'string' ? payload.role : undefined,
  };
}

// 便捷封装:直接从 Authorization 头校验出用户。
export async function authenticate(authorization: string | undefined | null): Promise<AuthedUser> {
  return verifyJwt(bearerToken(authorization));
}
