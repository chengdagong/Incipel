// app.ts HTTP 层(testing-strategy §3.5 + KI-6):请求校验、输入上限、/logline。
// 这些分支都在进入 SSE 流(调 store/provider)之前返回,无需 Supabase 或真实模型。
// DEV_NO_AUTH=1 跳过 JWT 校验。
// 本文件刻意不配 SUPABASE_*/模型 key:据此覆盖 createSessionIfMissing 失败(500)与 logline 无 key(502)。

import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';

// createApp() 在构造时读 DEV_NO_AUTH / STORE,故先设环境变量再建 app。
process.env.DEV_NO_AUTH = '1';
delete process.env.STORE;
const app = createApp();

function run(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function logline(raw: string): Promise<Response> {
  return app.request('/logline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
}

describe('KI-6 /run 输入上限', () => {
  it('超长 user 消息 → 413', async () => {
    expect((await run({ threadId: 't', messages: [{ role: 'user', content: 'x'.repeat(8001) }] })).status).toBe(413);
  });
  it('messages 过多 → 413', async () => {
    expect((await run({ threadId: 't', messages: Array.from({ length: 201 }, () => ({ role: 'user', content: 'hi' })) })).status).toBe(413);
  });
  it('请求体超字节上限 → 413(按实际字节,不依赖 Content-Length)', async () => {
    const big = 'x'.repeat(300 * 1024);
    const res = await app.request('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
    expect(res.status).toBe(413);
  });
});

describe('/run 既有输入校验', () => {
  it('body 非 JSON → 400', async () => {
    expect((await app.request('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' })).status).toBe(400);
  });
  it('缺 threadId → 400', async () => {
    expect((await run({ messages: [{ role: 'user', content: 'hi' }] })).status).toBe(400);
  });
  it('无 user 消息 → 400', async () => {
    expect((await run({ threadId: 't', messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(400);
  });
  it('多模态 content 的 text 片段被识别(否则视为无 user 消息 → 400)', async () => {
    // 多模态数组只含非 text → 取不到用户文本 → 400。
    expect((await run({ threadId: 't', messages: [{ role: 'user', content: [{ type: 'image', url: 'x' }] }] })).status).toBe(400);
  });
  it('正常请求通过校验,但无 Supabase 配置 → createSessionIfMissing 失败 500', async () => {
    expect((await run({ threadId: 't', messages: [{ role: 'user', content: '正常一句话' }] })).status).toBe(500);
  });
});

describe('/logline', () => {
  it('body 非 JSON → 400', async () => {
    expect((await logline('{nope')).status).toBe(400);
  });
  it('body 形状不合法(idea 非 string)→ 400', async () => {
    expect((await logline(JSON.stringify({ idea: 123 }))).status).toBe(400);
  });
  it('合法 body 但无模型 key → 502', async () => {
    expect((await logline(JSON.stringify({ idea: '一个怕黑的灯塔看守人' }))).status).toBe(502);
  });
  it('请求体超字节上限 → 413', async () => {
    expect((await logline('x'.repeat(300 * 1024))).status).toBe(413);
  });
});
