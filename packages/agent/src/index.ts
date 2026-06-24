import { serve } from '@hono/node-server';
import { MastraServer } from '@mastra/hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './env.ts';
import { getMastraApp } from './mastra-app.ts';
import { registerAgentHonoRoutes } from './routes.ts';

const host = env('HOST') || '127.0.0.1';
const rawPort = env('AGENT_PORT') || env('PORT') || '4111';
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`AGENT_PORT / PORT 必须是正整数,当前值: ${rawPort}`);
}

const app = new Hono();
registerAgentHonoRoutes(app);
app.use(
  '*',
  cors({
    credentials: true,
    origin: (origin) => {
      if (!origin) return origin;
      try {
        const url = new URL(origin);
        if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.protocol === 'http:') {
          return origin;
        }
      } catch {
        return null;
      }
      return null;
    },
  }),
);
const mastra = getMastraApp();
const server = new MastraServer({ app, mastra });
await server.init();

serve({ fetch: app.fetch, hostname: host, port });

// eslint-disable-next-line no-console
console.log(`[incipel-agent] Mastra application server listening on http://${host}:${port}`);
