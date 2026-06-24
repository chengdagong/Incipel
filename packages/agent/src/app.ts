// Agent 运行时的 Hono app(运行时无关)。
//
// 这里只有「应用本身」:路由、鉴权、输入校验、SSE 编排。它不 import 任何 Node 专属东西
// (没有 dotenv、没有 @hono/node-server),故运行时无关:当前由 Supabase Edge Function
// (supabase/functions/agent,Deno)用 `Deno.serve(createApp('/agent').fetch)` 托管;Node 入口已删
// (ADR-0008),真要迁专用主机时,加回一个 ~30 行的 Node 入口 + @hono/node-server 即可。环境变量经
// env() 读取,屏蔽 Deno.env 与 process.env 的差异。
//
// 客户端绝不持有模型密钥;所有模型调用都在这一层。每个受保护端点先校验 Supabase JWT。
//
// /run 是 AG-UI 端点:收 RunAgentInput(threadId/runId/messages/...),响应 text/event-stream。
// threadId 即会话标识;据它载入权威剧本(无则建会话与空剧本)。本轮用户消息取 input.messages
// 里最后一条 role==='user' 的 content。权威剧本以 DB 为准,不信任 input.state。
//
// basePath:Supabase Edge Function 对外路径是 `/functions/v1/<函数名>/…`,网关把请求以
// `/<函数名>/…` 交给运行时。故 Edge 用 createApp('/agent'),路由前缀对齐;无前缀的 createApp()
// 用于 vitest(app.request('/run'))与将来若重建的 Node 入口。

import type { Message, RunAgentInput } from '@ag-ui/core';
import { sse } from '@incipel/shared';
import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authenticate, AuthError } from './auth.ts';
import { generateLogline } from './logline.ts';
import { runTurnCore } from './run.ts';
import { createStore, type Store } from './store.ts';
import { MemoryStore } from './dev/memory-store.ts';
import { env } from './env.ts';

// ── 本地 dev 开关(仅本地试用;prod 绝不开)────────────────────────────────────
// DEV_NO_AUTH=1:跳过 Supabase JWT 校验,用固定 dev 用户。
// STORE=memory:用进程级内存 store,免依赖 Supabase schema(多轮在进程内持续,重启即丢)。
const DEV_USER_ID = 'dev-user';

const LoglineBody = z.object({
  // 兼容旧客户端字段;服务端不把它发给模型,骰子始终生成全新 logline。
  idea: z.string().optional(),
});

// /run 输入上限(见 docs/known-issues.md KI-6):约束单条 user 消息与 messages 数组大小,
// 防止单个大请求推高 token 成本/延迟、撞 Edge CPU 上限,或把大块文本写进 DB。
// §9 的「token 量有上界」原本只覆盖剧本状态与最近 N 轮窗口,这里补上单条新消息的上界。
const MAX_USER_MESSAGE_CHARS = 8000;
const MAX_MESSAGES = 200;
// 请求体字节硬上限:解析前按实际字节计数读取(见 readBodyCapped),不依赖 Content-Length,
// 超限即拒,避免把超大 body 整体读进内存(见 KI-6)。给 messages 数组 + 单条消息上限留足余量。
const MAX_BODY_BYTES = 256 * 1024;

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
          .map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text'
            ? String((p as { text?: unknown }).text ?? '')
            : ''))
          .join('')
          .trim();
      }
      return '';
    }
  }
  return '';
}

// 按硬字节上限读取请求体,返回文本;超限返回 null。不依赖 Content-Length——直接对实际字节
// 计数,故省略/伪造/分块传输都挡得住(见 KI-6 / Codex 评审 P2)。读到 max 即停,不会把超大 body
// 整体读进内存。
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

// 构造 agent 的 Hono app。basePath 为空则不加前缀(Node 本地直连);Edge 传 '/agent'。
// DEV_NO_AUTH / STORE 在构造时读取(env() 取 Deno.env 或 process.env):
// 既支持 Edge 启动时读 secret,也兼容测试在 import 前 set/delete process.env 的既有用法。
export function createApp(basePath = ''): Hono {
  const DEV_NO_AUTH = env('DEV_NO_AUTH') === '1';
  const memoryStore: Store | null = env('STORE') === 'memory' ? new MemoryStore() : null;
  const getStore = (): Store => memoryStore ?? createStore();

  // DEV_NO_AUTH 用固定的 dev-user,它不是合法的 auth.users UUID;若搭 SupabaseStore(STORE≠memory),
  // 首轮 create_session_if_missing(uuid) 必失败、只报含糊 500。二者必须成对(见 ADR-0009、评审 #5)。
  // 日常 dev 应走 anonymous auth(不设 DEV_NO_AUTH);这里仅在误配时给一条明确告警。
  if (DEV_NO_AUTH && !memoryStore) {
    console.warn(
      '[incipel-agent] DEV_NO_AUTH=1 但 STORE≠memory:固定 dev-user 不是合法 UUID,SupabaseStore 建会话会失败。请改走 anonymous auth(不设 DEV_NO_AUTH),或与 STORE=memory 同用(见 ADR-0009)。',
    );
  }

  const app = basePath ? new Hono().basePath(basePath) : new Hono();

  // ── /health ────────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ ok: true, service: 'incipel-agent' }));

  // ── POST /run:AG-UI 一轮,收 RunAgentInput,SSE 流式回 AG-UI 事件 ───────────────
  app.post('/run', async (c) => {
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

    // 按硬字节上限读取 body(不依赖 Content-Length,见 KI-6 / Codex P2),超限即拒。
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

    // forwardedProps 可带新建会话用的 accent / title,以及自定义的助手显示名 assistantName。
    const fp = (input.forwardedProps ?? {}) as {
      accent?: string;
      title?: string;
      assistantName?: string;
      genre?: string;
    };
    // 助手显示名:客户端传入则用之;为空 / 不传 / 非法时,由 prompt 层清洗并回落默认「主管编剧」。
    // 这是「用户自定义助手名」的服务端入口;日后可改为按会话/用户持久化读取。
    // 注意:这里是原始客户端值,清洗(防 prompt injection)在 prompt.ts 的 sanitizeAssistantName。
    const assistantName = typeof fp.assistantName === 'string' ? fp.assistantName : undefined;
    // 题材:欢迎屏选定后经 forwardedProps 传入,仅首轮作定调提示注入(不进用户消息)。
    const genre = typeof fp.genre === 'string' ? fp.genre : undefined;

    const store = getStore();
    // 据 threadId 建会话与空剧本(已存在则不动);这同时让本轮成为该会话的「新连接」。
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

    // 每个 /run 都补发 STATE_SNAPSHOT 基线:断流重连后客户端据此恢复一致(见 system-design §11)。
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
  });

  // ── POST /logline:便宜模型生成一句 logline(一次性,非流式)──────────────────
  app.post('/logline', async (c) => {
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
  });

  return app;
}
