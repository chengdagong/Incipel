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

vi.mock('../src/mastra/index.ts', () => ({
  getMastraApp: () => h.mastra,
}));

vi.mock('../src/routes.ts', () => ({
  registerAgentHonoRoutes: (app: any) => {
    h.agentRoutesApp = app;
    h.agentRoutesCalls += 1;
    app.post('/run', (c: any) => c.json({ ok: true, route: 'run' }));
    app.post('/logline', (c: any) => c.json({ ok: true, route: 'logline' }));
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

  it('Mastra API 路由允许 Studio 跨源访问', async () => {
    await import('../src/index');

    const res = await h.serverConfig.app.request('/api/agents', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3001',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('Studio 读取 auth capabilities 时允许携带凭据', async () => {
    await import('../src/index');

    const res = await h.serverConfig.app.request('/api/auth/capabilities', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3001',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
  });

  it('Mastra Studio API preflight 保留 Mastra headers 和管理方法', async () => {
    await import('../src/index');

    const res = await h.serverConfig.app.request('/api/agents/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3001',
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'content-type, x-mastra-client-type, x-mastra-dev-playground',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-mastra-client-type');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-mastra-dev-playground');
  });

  it('Studio 探测 agent server 根路径时也能通过跨源检查', async () => {
    await import('../src/index');

    const res = await h.serverConfig.app.request('/', {
      headers: {
        Origin: 'http://localhost:3001',
      },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('/run 允许浏览器 preflight 和 POST 跨源访问', async () => {
    await import('../src/index');

    const preflight = await h.serverConfig.app.request('/run', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:19081',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, authorization',
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:19081');
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');

    const post = await h.serverConfig.app.request('/run', {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:19081',
        'Content-Type': 'application/json',
        Authorization: 'Bearer test',
      },
      body: '{}',
    });

    expect(post.status).toBe(200);
    expect(post.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:19081');
    expect(post.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('/logline 允许浏览器 preflight 和 POST 跨源访问', async () => {
    await import('../src/index');

    const preflight = await h.serverConfig.app.request('/logline', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:19082',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, authorization',
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:19082');
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');

    const post = await h.serverConfig.app.request('/logline', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:19082',
        'Content-Type': 'application/json',
        Authorization: 'Bearer test',
      },
      body: '{}',
    });

    expect(post.status).toBe(200);
    expect(post.headers.get('access-control-allow-origin')).toBe('http://localhost:19082');
    expect(post.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('端口不是正整数时直接报错', async () => {
    process.env.AGENT_PORT = 'nope';

    await expect(import('../src/index')).rejects.toThrow(/AGENT_PORT \/ PORT/);
  });
});
