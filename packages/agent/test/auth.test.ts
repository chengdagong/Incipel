// KI-4 + §3.4:verifyJwt 校验签名 + issuer/audience;bearerToken 解析;HS256 后备与 JWKS 默认路径。
// HS256 用 jose 现签;JWKS 路径 mock createRemoteJWKSet 返回本地 ES256 公钥(不碰网络)。

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

// 供 mock 工厂读取的本地 ES256 公钥(vi.mock 会被提升)。
const h = vi.hoisted(() => ({ publicKey: null as any }));

// 只替换 createRemoteJWKSet —— 让它返回一个直接给出本地公钥的 resolver;其余 jose 用真实实现。
vi.mock('jose', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, createRemoteJWKSet: () => async () => h.publicKey };
});

const SECRET_TEXT = 'test-secret-0123456789-abcdefghij';
const secret = new TextEncoder().encode(SECRET_TEXT);
const SUPABASE_URL = 'https://proj.supabase.co';
const ISS = `${SUPABASE_URL}/auth/v1`;

let esPrivate: any;

beforeAll(async () => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_JWT_SECRET = SECRET_TEXT;
  delete process.env.INCIPEL_SUPABASE_JWT_SECRET;
  delete process.env.INCIPEL_SUPABASE_JWT_ISS;
  delete process.env.INCIPEL_SUPABASE_JWT_AUD;
  delete process.env.SUPABASE_JWT_ISS;
  delete process.env.SUPABASE_JWT_AUD;
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  h.publicKey = publicKey;
  esPrivate = privateKey;
  await exportJWK(publicKey); // 触碰一次,确保 key 可用
});

type MintOpts = { iss?: string | null; aud?: string | null; exp?: string | null; alg?: 'HS256' | 'ES256' };

async function mint(claims: Record<string, unknown>, o: MintOpts = {}): Promise<string> {
  const { iss = ISS, aud = 'authenticated', exp = '2h', alg = 'HS256' } = o;
  let t = new SignJWT(claims).setProtectedHeader({ alg }).setIssuedAt();
  if (iss) t = t.setIssuer(iss);
  if (aud) t = t.setAudience(aud);
  if (exp) t = t.setExpirationTime(exp);
  return t.sign(alg === 'ES256' ? esPrivate : secret);
}

describe('bearerToken', () => {
  it('缺 Authorization → AuthError', async () => {
    const { bearerToken, AuthError } = await import('../src/auth');
    expect(() => bearerToken(undefined)).toThrow(AuthError);
    expect(() => bearerToken(null)).toThrow(AuthError);
  });
  it('scheme 非 bearer → AuthError', async () => {
    const { bearerToken, AuthError } = await import('../src/auth');
    expect(() => bearerToken('Token abc')).toThrow(AuthError);
  });
  it('空 token → AuthError', async () => {
    const { bearerToken, AuthError } = await import('../src/auth');
    expect(() => bearerToken('Bearer ')).toThrow(AuthError);
  });
  it('合法 → 取出裸 token(大小写不敏感的 scheme)', async () => {
    const { bearerToken } = await import('../src/auth');
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });
});

describe('verifyJwt — HS256 后备路径', () => {
  it('有效用户 token → 取出 userId', async () => {
    const { verifyJwt } = await import('../src/auth');
    expect((await verifyJwt(await mint({ sub: 'user-123', role: 'authenticated' }))).userId).toBe('user-123');
  });
  it('anonymous user 同样放行', async () => {
    const { verifyJwt } = await import('../src/auth');
    expect((await verifyJwt(await mint({ sub: 'anon-1', role: 'authenticated', is_anonymous: true }))).userId).toBe('anon-1');
  });
  it('过期 → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    await expect(verifyJwt(await mint({ sub: 'u' }, { exp: '-1h' }))).rejects.toBeInstanceOf(AuthError);
  });
  it('缺 sub → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    await expect(verifyJwt(await mint({ role: 'authenticated' }))).rejects.toBeInstanceOf(AuthError);
  });
  it('解析失败(非 JWT 串)→ 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    await expect(verifyJwt('not-a-jwt')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('verifyJwt — issuer / audience(KI-4)', () => {
  it('issuer 指向别的项目 → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    await expect(verifyJwt(await mint({ sub: 'u' }, { iss: 'https://evil.supabase.co/auth/v1' }))).rejects.toBeInstanceOf(AuthError);
  });
  it('audience 不是 authenticated → 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    await expect(verifyJwt(await mint({ sub: 'u' }, { aud: 'other' }))).rejects.toBeInstanceOf(AuthError);
  });
  it('同密钥签出的 service_role token(iss=supabase、无 aud)被拒', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    await expect(verifyJwt(await mint({ sub: 'service_role', role: 'service_role' }, { iss: 'supabase', aud: null }))).rejects.toBeInstanceOf(AuthError);
  });
  it('本地 agent server(SUPABASE_URL 指向本地)可用 INCIPEL_* 覆盖 issuer 与 HS256 secret', async () => {
    const { verifyJwt } = await import('../src/auth');
    const previousSecret = process.env.SUPABASE_JWT_SECRET;
    const previousUrl = process.env.SUPABASE_URL;
    // 围栏要求 SUPABASE_URL 指向本地(http + loopback/kong)才采纳 INCIPEL_*(评审 #1)。
    process.env.SUPABASE_URL = 'http://127.0.0.1:54521';
    process.env.INCIPEL_SUPABASE_JWT_SECRET = SECRET_TEXT;
    process.env.INCIPEL_SUPABASE_JWT_ISS = 'http://127.0.0.1:54521/auth/v1';
    delete process.env.SUPABASE_JWT_SECRET;
    try {
      const token = await mint(
        { sub: 'local-anon', role: 'authenticated', is_anonymous: true },
        { iss: 'http://127.0.0.1:54521/auth/v1' },
      );
      expect((await verifyJwt(token)).userId).toBe('local-anon');
    } finally {
      process.env.SUPABASE_URL = previousUrl as string;
      if (previousSecret) process.env.SUPABASE_JWT_SECRET = previousSecret;
      else delete process.env.SUPABASE_JWT_SECRET;
      delete process.env.INCIPEL_SUPABASE_JWT_SECRET;
      delete process.env.INCIPEL_SUPABASE_JWT_ISS;
    }
  });
  it('托管生产(SUPABASE_URL 为 https)忽略 INCIPEL_* 覆盖,误入的 secret 不点亮 HS256 旁路', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    // SUPABASE_URL 仍是 https://proj.supabase.co(beforeAll 设的);此处即便设了 INCIPEL_*,围栏也不采纳。
    process.env.INCIPEL_SUPABASE_JWT_SECRET = SECRET_TEXT;
    process.env.INCIPEL_SUPABASE_JWT_ISS = 'http://127.0.0.1:54521/auth/v1';
    delete process.env.SUPABASE_JWT_SECRET; // 生产没有 SUPABASE_JWT_SECRET → HS256 应整体关闭
    try {
      // 用 INCIPEL_ISS 那个本地 issuer 签的 HS256 token:若围栏失效会被接受;有围栏则因
      // 既无 HS256 secret(jwtSecretKey 抛错)、issuer 也不匹配而被拒。
      const token = await mint(
        { sub: 'forged', role: 'authenticated' },
        { iss: 'http://127.0.0.1:54521/auth/v1' },
      );
      await expect(verifyJwt(token)).rejects.toBeInstanceOf(AuthError);
    } finally {
      process.env.SUPABASE_JWT_SECRET = SECRET_TEXT;
      delete process.env.INCIPEL_SUPABASE_JWT_SECRET;
      delete process.env.INCIPEL_SUPABASE_JWT_ISS;
    }
  });
});

describe('verifyJwt — JWKS / 非对称默认路径', () => {
  it('ES256 经 mock 的 JWKS 公钥验签成功 → 取出 userId', async () => {
    const { verifyJwt } = await import('../src/auth');
    const token = await mint({ sub: 'user-es', role: 'authenticated' }, { alg: 'ES256' });
    expect((await verifyJwt(token)).userId).toBe('user-es');
  });
  it('alg=none(无签名)→ 拒绝', async () => {
    const { verifyJwt, AuthError } = await import('../src/auth');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u', iss: ISS, aud: 'authenticated' })}.`;
    await expect(verifyJwt(noneToken)).rejects.toBeInstanceOf(AuthError);
  });
});
