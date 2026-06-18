// KI-6 回归测试:/run 入口对输入大小设上限;一并覆盖既有的请求校验分支。
// 这些分支都在进入 SSE 流(调 store / provider)之前返回,故无需 Supabase 或真实模型。
// 设 INCIPEL_RUNTIME=edge 跳过本地 node-server 启动;DEV_NO_AUTH=1 跳过 JWT 校验。

import { describe, it, expect } from 'vitest';

process.env.INCIPEL_RUNTIME = 'edge';
process.env.DEV_NO_AUTH = '1';
const { app } = await import('../src/index');

function post(body: unknown): Promise<Response> {
  return app.request('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('KI-6 /run 输入上限', () => {
  it('超长 user 消息 → 413', async () => {
    const res = await post({ threadId: 't', messages: [{ role: 'user', content: 'x'.repeat(8001) }] });
    expect(res.status).toBe(413);
  });

  it('messages 过多 → 413', async () => {
    const res = await post({
      threadId: 't',
      messages: Array.from({ length: 201 }, () => ({ role: 'user', content: 'hi' })),
    });
    expect(res.status).toBe(413);
  });

  it('正常大小消息通过大小校验(不返回 413)', async () => {
    const res = await post({ threadId: 't', messages: [{ role: 'user', content: '正常一句话' }] });
    expect(res.status).not.toBe(413);
  });
});

describe('/run 既有输入校验', () => {
  it('缺 threadId → 400', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(400);
  });

  it('无 user 消息 → 400', async () => {
    const res = await post({ threadId: 't', messages: [{ role: 'assistant', content: 'hi' }] });
    expect(res.status).toBe(400);
  });
});
