// index.ts 鉴权分支(testing-strategy §3.5):DEV_NO_AUTH 关闭时,坏/缺 Authorization → 401。
// 单独成文件:本文件不设 DEV_NO_AUTH,使 /run、/logline 走真实 authenticate。

import { describe, it, expect } from 'vitest';

process.env.INCIPEL_RUNTIME = 'edge';
delete process.env.DEV_NO_AUTH;
const { app } = await import('../src/index');

function runWith(headers: Record<string, string>): Promise<Response> {
  return app.request('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ threadId: 't', messages: [{ role: 'user', content: 'hi' }] }),
  });
}

describe('/run 鉴权(DEV_NO_AUTH 关闭)', () => {
  it('缺 Authorization → 401', async () => {
    expect((await runWith({})).status).toBe(401);
  });
  it('Authorization 格式错(非 Bearer)→ 401', async () => {
    expect((await runWith({ Authorization: 'Token xyz' })).status).toBe(401);
  });
  it('Bearer 后是无法解析的 token → 401', async () => {
    expect((await runWith({ Authorization: 'Bearer not-a-jwt' })).status).toBe(401);
  });
});

describe('/logline 鉴权(DEV_NO_AUTH 关闭)', () => {
  it('缺 Authorization → 401', async () => {
    const res = await app.request('/logline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('/health', () => {
  it('返回 ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'incipel-agent' });
  });
});
