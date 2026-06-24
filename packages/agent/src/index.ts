import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { env } from './env.ts';

const host = env('HOST') || '127.0.0.1';
const rawPort = env('AGENT_PORT') || env('PORT') || '4111';
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`AGENT_PORT / PORT 必须是正整数,当前值: ${rawPort}`);
}

serve({ fetch: createApp().fetch, hostname: host, port });

// eslint-disable-next-line no-console
console.log(`[incipel-agent] Mastra agent server listening on http://${host}:${port}`);
