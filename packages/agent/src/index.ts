import { serve } from '@hono/node-server';
import { MastraServer } from '@mastra/hono';
import { Hono } from 'hono';
import { env } from './env.ts';
import { getMastraApp } from './mastra-app.ts';

const host = env('HOST') || '127.0.0.1';
const rawPort = env('AGENT_PORT') || env('PORT') || '4111';
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`AGENT_PORT / PORT 必须是正整数,当前值: ${rawPort}`);
}

const app = new Hono();
const mastra = getMastraApp();
const server = new MastraServer({ app, mastra });
await server.init();

serve({ fetch: app.fetch, hostname: host, port });

// eslint-disable-next-line no-console
console.log(`[incipel-agent] Mastra application server listening on http://${host}:${port}`);
