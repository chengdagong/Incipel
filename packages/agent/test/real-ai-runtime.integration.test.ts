import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventType, type JsonPatchOp } from '@incipel/shared';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../supabase/.env'), quiet: true });
loadEnv({ path: resolve(here, '../.env'), quiet: true });

const enabled = process.env.INCIPEL_REAL_AI_INTEGRATION === '1';
const realAiIt = enabled ? it : it.skip;

type WireEvent = Record<string, unknown>;

function parseSse(body: string): WireEvent[] {
  return body
    .split(/\r?\n\r?\n/)
    .flatMap((frame) => {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n');
      if (!data) return [];
      return [JSON.parse(data) as WireEvent];
    });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stateDeltas(events: WireEvent[]): JsonPatchOp[] {
  return events
    .filter((event) => event.type === EventType.STATE_DELTA)
    .flatMap((event) => (Array.isArray(event.delta) ? event.delta : [])) as JsonPatchOp[];
}

function eventTypes(events: WireEvent[]): unknown[] {
  return events.map((event) => event.type);
}

describe('真实 AI runtime integration', () => {
  realAiIt(
    '生成 logline 后,把该 logline 交给真实 AI runtime 完成一轮生成',
    async () => {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY 未配置。请在 supabase/.env 中填写后再运行 test:real-ai。');
      }

      const previousEnv = {
        DEV_NO_AUTH: process.env.DEV_NO_AUTH,
        MODEL_PROVIDER: process.env.MODEL_PROVIDER,
        STORE: process.env.STORE,
      };

      process.env.DEV_NO_AUTH = '1';
      process.env.MODEL_PROVIDER = 'openrouter';
      process.env.STORE = 'memory';

      try {
        const { createApp } = await import('../src/app.ts');
        const app = createApp();

        const loglineRes = await app.request('/logline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        expect(loglineRes.status).toBe(200);
        const loglineBody = (await loglineRes.json()) as { logline?: unknown };
        expect(isNonEmptyString(loglineBody.logline)).toBe(true);

        const logline = String(loglineBody.logline).trim();
        expect(logline.length).toBeGreaterThan(8);
        expect(logline.length).toBeLessThan(240);

        const threadId = `real-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const runId = `${threadId}-run`;
        const prompt =
          `请把这句 logline 作为故事起点,完成第一轮创作:给标题、核心人物、开场方向和下一步选项。\n` +
          `logline: ${logline}`;

        const runRes = await app.request('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId,
            runId,
            messages: [{ id: `${threadId}-user`, role: 'user', content: prompt }],
          }),
        });

        expect(runRes.status).toBe(200);
        expect(runRes.headers.get('content-type') ?? '').toContain('text/event-stream');

        const events = parseSse(await runRes.text());
        const errorEvent = events.find((event) => event.type === EventType.RUN_ERROR);
        if (errorEvent) {
          throw new Error(`真实 AI runtime 返回 RUN_ERROR: ${JSON.stringify(errorEvent)}`);
        }

        const types = eventTypes(events);
        expect(types).toContain(EventType.RUN_STARTED);
        expect(types).toContain(EventType.STATE_SNAPSHOT);
        expect(types).toContain(EventType.RUN_FINISHED);

        const meaningfulDeltas = stateDeltas(events).filter(
          (delta) => typeof delta.path === 'string' && delta.path !== '/meta/updatedAt',
        );
        expect(meaningfulDeltas.length).toBeGreaterThan(0);

        const assistantText = events
          .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
          .map((event) => String(event.delta ?? ''))
          .join('');
        expect(assistantText.trim().length).toBeGreaterThan(0);
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    },
    180_000,
  );
});
