import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mastra: { id: 'test-mastra-app' },
  serveOptions: null as any,
  serverConfig: null as any,
  agentRoutesApp: null as any,
  agentRoutesCalls: 0,
  initCalls: 0,
  initCompleted: false,
  initCompletedAtServe: false,
}));

vi.mock('@hono/node-server', () => ({
  serve: (options: any) => {
    h.initCompletedAtServe = h.initCompleted;
    h.serveOptions = options;
    return { close: () => undefined };
  },
}));

vi.mock('@mastra/hono', () => ({
  MastraServer: class {
    constructor(config: any) {
      h.serverConfig = config;
    }

    async init() {
      h.initCalls += 1;
      h.initCompleted = true;
    }
  },
}));

vi.mock('../src/mastra-app.ts', () => ({
  getMastraApp: () => h.mastra,
}));

vi.mock('../src/routes.ts', () => ({
  registerAgentHonoRoutes: (app: any) => {
    h.agentRoutesApp = app;
    h.agentRoutesCalls += 1;
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.serveOptions = null;
  h.serverConfig = null;
  h.agentRoutesApp = null;
  h.agentRoutesCalls = 0;
  h.initCalls = 0;
  h.initCompleted = false;
  h.initCompletedAtServe = false;
  delete process.env.HOST;
  delete process.env.PORT;
  delete process.env.AGENT_PORT;
});

describe('Node agent server entry', () => {
  it('默认监听 127.0.0.1:4111,并在 MastraServer 初始化后托管 Hono app', async () => {
    await import('../src/index');

    expect(h.serverConfig?.mastra).toBe(h.mastra);
    expect(h.agentRoutesApp).toBe(h.serverConfig.app);
    expect(h.agentRoutesCalls).toBe(1);
    expect(h.initCalls).toBe(1);
    expect(h.initCompletedAtServe).toBe(true);
    expect(h.serveOptions).toMatchObject({
      hostname: '127.0.0.1',
      port: 4111,
    });
    expect(h.serveOptions.fetch).toBe(h.serverConfig.app.fetch);
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
