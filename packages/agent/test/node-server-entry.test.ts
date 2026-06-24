import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fetch: (() => undefined) as unknown as typeof fetch,
  serveOptions: null as any,
}));

vi.mock('@hono/node-server', () => ({
  serve: (options: any) => {
    h.serveOptions = options;
    return { close: () => undefined };
  },
}));

vi.mock('../src/app.ts', () => ({
  createApp: () => ({ fetch: h.fetch }),
}));

beforeEach(() => {
  vi.resetModules();
  h.serveOptions = null;
  delete process.env.HOST;
  delete process.env.PORT;
  delete process.env.AGENT_PORT;
});

describe('Node agent server entry', () => {
  it('默认监听 127.0.0.1:4111 并托管 createApp().fetch', async () => {
    await import('../src/index');

    expect(h.serveOptions).toMatchObject({
      fetch: h.fetch,
      hostname: '127.0.0.1',
      port: 4111,
    });
  });

  it('AGENT_PORT 优先于 PORT,HOST 可配置', async () => {
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '5000';
    process.env.AGENT_PORT = '5111';

    await import('../src/index');

    expect(h.serveOptions).toMatchObject({
      hostname: '0.0.0.0',
      port: 5111,
    });
  });

  it('端口不是正整数时直接报错', async () => {
    process.env.AGENT_PORT = 'nope';

    await expect(import('../src/index')).rejects.toThrow(/AGENT_PORT \/ PORT/);
  });
});
