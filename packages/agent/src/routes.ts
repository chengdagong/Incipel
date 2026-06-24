import type { Message, RunAgentInput } from '@ag-ui/core';
import { registerApiRoute, type ApiRoute } from '@mastra/core/server';
import { sse } from '@incipel/shared';
import type { Context, Hono } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authenticate, AuthError } from './auth.ts';
import { MemoryStore } from './dev/memory-store.ts';
import { env } from './env.ts';
import { generateLogline } from './logline.ts';
import { runTurnCore } from './run.ts';
import { createStore, type Store } from './store.ts';

const DEV_USER_ID = 'dev-user';

const LoglineBody = z.object({
  // 兼容旧客户端字段;服务端不把它发给模型,骰子始终生成全新 logline。
  idea: z.string().optional(),
});

// /run 输入上限(见 docs/known-issues.md KI-6):约束单条 user 消息与 messages 数组大小,
// 防止单个大请求推高 token 成本/延迟,或把大块文本写进数据库。
const MAX_USER_MESSAGE_CHARS = 8000;
const MAX_MESSAGES = 200;
// 请求体字节硬上限:解析前按实际字节计数读取,不依赖 Content-Length。
const MAX_BODY_BYTES = 256 * 1024;

type AgentRouteHandlers = {
  health: (c: Context) => Response | Promise<Response>;
  run: (c: Context) => Response | Promise<Response>;
  logline: (c: Context) => Response | Promise<Response>;
};

// 从 RunAgentInput.messages 取最后一条 user 消息的纯文本。
function lastUserText(messages: Message[] | undefined): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      const content = (m as { content?: unknown }).content;
      if (typeof content === 'string') return content;
      // 多模态 content:拼接其中的 text 片段。
      if (Array.isArray(content)) {
        return content
          .map((p) =>
            p && typeof p === 'object' && (p as { type?: string }).type === 'text'
              ? String((p as { text?: unknown }).text ?? '')
              : '',
          )
          .join('')
          .trim();
      }
      return '';
    }
  }
  return '';
}

// 按硬字节上限读取请求体,返回文本;超限返回 null。不依赖 Content-Length。
async function readBodyCapped(c: Context, max: number): Promise<string | null> {
  const body = c.req.raw.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > max) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    merged.set(ch, off);
    off += ch.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function createAgentRouteHandlers(): AgentRouteHandlers {
  const DEV_NO_AUTH = env('DEV_NO_AUTH') === '1';
  const memoryStore: Store | null = env('STORE') === 'memory' ? new MemoryStore() : null;
  const getStore = (): Store => memoryStore ?? createStore();

  if (DEV_NO_AUTH && !memoryStore) {
    console.warn(
      '[incipel-agent] DEV_NO_AUTH=1 但 STORE≠memory:固定 dev-user 不是合法 UUID,SupabaseStore 建会话会失败。请改走 anonymous auth(不设 DEV_NO_AUTH),或与 STORE=memory 同用(见 ADR-0009)。',
    );
  }

  return {
    health: (c) => c.json({ ok: true, service: 'incipel-agent' }),

    async run(c) {
      let user: { userId: string };
      if (DEV_NO_AUTH) {
        user = { userId: DEV_USER_ID };
      } else {
        try {
          user = await authenticate(c.req.header('Authorization'));
        } catch (err) {
          const status = err instanceof AuthError ? 401 : 500;
          return c.json({ error: (err as Error).message }, status);
        }
      }

      const rawBody = await readBodyCapped(c, MAX_BODY_BYTES);
      if (rawBody === null) {
        return c.json({ error: `请求体过大(上限 ${MAX_BODY_BYTES} 字节)` }, 413);
      }

      let input: RunAgentInput;
      try {
        input = JSON.parse(rawBody) as RunAgentInput;
      } catch (err) {
        return c.json({ error: `请求体不合法: ${(err as Error).message}` }, 400);
      }

      const threadId = input.threadId;
      if (typeof threadId !== 'string' || !threadId) {
        return c.json({ error: 'RunAgentInput.threadId 缺失' }, 400);
      }
      const runId = typeof input.runId === 'string' && input.runId ? input.runId : nanoid();

      if (Array.isArray(input.messages) && input.messages.length > MAX_MESSAGES) {
        return c.json({ error: `messages 过多(上限 ${MAX_MESSAGES} 条)` }, 413);
      }

      const userMessage = lastUserText(input.messages);
      if (!userMessage) {
        return c.json({ error: 'messages 中没有可用的 user 消息' }, 400);
      }
      if (userMessage.length > MAX_USER_MESSAGE_CHARS) {
        return c.json({ error: `本轮消息过长(上限 ${MAX_USER_MESSAGE_CHARS} 字)` }, 413);
      }

      const fp = (input.forwardedProps ?? {}) as {
        accent?: string;
        title?: string;
        assistantName?: string;
        genre?: string;
      };
      const assistantName = typeof fp.assistantName === 'string' ? fp.assistantName : undefined;
      const genre = typeof fp.genre === 'string' ? fp.genre : undefined;

      const store = getStore();
      try {
        await store.createSessionIfMissing({
          threadId,
          userId: user.userId,
          accent: typeof fp.accent === 'string' ? fp.accent : undefined,
          title: typeof fp.title === 'string' ? fp.title : undefined,
        });
      } catch (err) {
        return c.json({ error: `创建会话失败: ${(err as Error).message}` }, 500);
      }

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return stream(c, async (s) => {
        for await (const event of runTurnCore(
          {
            threadId,
            runId,
            userId: user.userId,
            userMessage,
            newConnection: true,
            assistantName,
            genre,
          },
          { store },
        )) {
          await s.write(sse(event));
        }
      });
    },

    async logline(c) {
      if (!DEV_NO_AUTH) {
        try {
          await authenticate(c.req.header('Authorization'));
        } catch (err) {
          const status = err instanceof AuthError ? 401 : 500;
          return c.json({ error: (err as Error).message }, status);
        }
      }

      const rawBody = await readBodyCapped(c, MAX_BODY_BYTES);
      if (rawBody === null) {
        return c.json({ error: `请求体过大(上限 ${MAX_BODY_BYTES} 字节)` }, 413);
      }
      try {
        LoglineBody.parse(JSON.parse(rawBody));
      } catch (err) {
        return c.json({ error: `请求体不合法: ${(err as Error).message}` }, 400);
      }

      try {
        const result = await generateLogline({});
        return c.json(result);
      } catch (err) {
        return c.json({ error: `生成 logline 失败: ${(err as Error).message}` }, 502);
      }
    },
  };
}

export function registerAgentHonoRoutes(app: Hono): void {
  const handlers = createAgentRouteHandlers();
  app.get('/health', handlers.health);
  app.post('/run', handlers.run);
  app.post('/logline', handlers.logline);
}

export function createAgentApiRoutes(): ApiRoute[] {
  const handlers = createAgentRouteHandlers();
  return [
    registerApiRoute('/health', {
      method: 'GET',
      requiresAuth: false,
      handler: handlers.health as any,
    }),
    registerApiRoute('/run', {
      method: 'POST',
      requiresAuth: false,
      handler: handlers.run as any,
    }),
    registerApiRoute('/logline', {
      method: 'POST',
      requiresAuth: false,
      handler: handlers.logline as any,
    }),
  ];
}
