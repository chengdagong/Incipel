// KI-4 回归测试:verifyJwt 除签名外,校验 issuer / audience;并拒绝同密钥签出的非用户 token。
// 用 jose 在测试里现签 HS256 token(走后备路径,无需 JWKS 网络)。

import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

const SECRET_TEXT = 'test-secret-0123456789-abcdefghij';
const secret = new TextEncoder().encode(SECRET_TEXT);
const SUPABASE_URL = 'https://proj.supabase.co';
const ISS = `${SUPABASE_URL}/auth/v1`;

beforeAll(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_JWT_SECRET = SECRET_TEXT;
  delete process.env.SUPABASE_JWT_ISS;
  delete process.env.SUPABASE_JWT_AUD;
});

type MintOpts = { iss?: string | null; aud?: string | null; exp?: string | null };

async function mint(
  claims: Record<string, unknown>,
  { iss = ISS, aud = 'authenticated', exp = '2h' }: MintOpts = {},
): Promise<string> {
  let t = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (iss) t = t.setIssuer(iss);
  if (aud) t = t.setAudience(aud);
  if (exp) t = t.setExpirationTime(exp);
  return t.sign(secret);
}

describe('KI-4 verifyJwt issuer/audience', () => {
  it('正确 iss + aud=authenticated 的用户 token → 取出 userId', async () => {
    const { verifyJwt } = await import('../src/auth');
    const token = await mint({ sub: 'user-123', role: 'authenticated' });
    const user = await verifyJwt(token);
    expect(user.userId).toBe('user-123');
  });

  it('匿名用户(role=anon, aud=authenticated)同样放行', async () => {
    const { verifyJwt } = await import('../src/auth');
    const token = await mint({ sub: 'anon-1', role: 'anon' });
    const user = await verifyJwt(token);
    expect(user.userId).toBe('anon-1');
  });

  it('issuer 指向别的项目 → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    const token = await mint({ sub: 'user-123' }, { iss: 'https://evil.supabase.co/auth/v1' });
    await expect(verifyJwt(token)).rejects.toBeInstanceOf(AuthError);
  });

  it('audience 不是 authenticated → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    const token = await mint({ sub: 'user-123' }, { aud: 'other-service' });
    await expect(verifyJwt(token)).rejects.toBeInstanceOf(AuthError);
  });

  it('同密钥签出的 service_role token(iss=supabase, 无 aud)被拒,不当作用户', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    const token = await mint({ sub: 'service_role', role: 'service_role' }, { iss: 'supabase', aud: null });
    await expect(verifyJwt(token)).rejects.toBeInstanceOf(AuthError);
  });

  it('过期 token → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    const token = await mint({ sub: 'user-123' }, { exp: '-1h' });
    await expect(verifyJwt(token)).rejects.toBeInstanceOf(AuthError);
  });

  it('缺 sub → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    const token = await mint({ role: 'authenticated' });
    await expect(verifyJwt(token)).rejects.toBeInstanceOf(AuthError);
  });
});
