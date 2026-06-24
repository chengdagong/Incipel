// 测试用 Hono app wrapper。生产入口由 Mastra application + Hono server adapter 托管同一组 routes。
// 保留 createApp() 是为了让现有 app.request() 测试继续直接覆盖 /run、/logline 与 /health。

import { Hono } from 'hono';
import { registerAgentHonoRoutes } from './routes.ts';

export function createApp(basePath = ''): Hono {
  const app = basePath ? new Hono().basePath(basePath) : new Hono();
  registerAgentHonoRoutes(app);
  return app;
}
