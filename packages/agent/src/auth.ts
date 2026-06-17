// 校验客户端发来的 Supabase JWT,取出 user_id。
// agent 是唯一调用模型、并以 service role 读写 Postgres 的地方;它必须先确认
// 请求方身份,再把会话限定在该用户(见 system-design §4)。校验失败即抛错,绝不放行。

import { jwtVerify } from 'jose';

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

function jwtSecretKey(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new AuthError('SUPABASE_JWT_SECRET 未配置');
  }
  return new TextEncoder().encode(secret);
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

// Supabase 默认用 HS256 + 项目 JWT secret 对 access token 签名。
export async function verifyJwt(token: string): Promise<AuthedUser> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, jwtSecretKey(), {
      algorithms: ['HS256'],
    });
    payload = result.payload as Record<string, unknown>;
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
