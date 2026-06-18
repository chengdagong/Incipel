// Agent 运行时入口(Hono app)。
//
// 同一份 Hono app 既可在本地用 @hono/node-server 起服务(本文件底部),也可原样部署到
// Supabase Edge Function(Deno):agent 无状态,Hono 与部署目标解耦,迁移是改部署目标
// 而非重写(见 docs/adr/0002)。Edge 入口形如:
//   import { app } from './index';
//   Deno.serve(app.fetch);
// (Edge 下不执行下方 @hono/node-server 启动块——它仅在以 Node 直接跑本文件时生效。)
//
// 客户端绝不持有模型密钥;所有模型调用都在这一层。每个受保护端点先校验 Supabase JWT。
//
// /run 是 AG-UI 端点:收 RunAgentInput(threadId/runId/messages/...),响应 text/event-stream。
// threadId 即会话标识;据它载入权威剧本(无则建会话与空剧本)。本轮用户消息取 input.messages
// 里最后一条 role==='user' 的 content。权威剧本以 DB 为准,不信任 input.state。

import 'dotenv/config'; // 本地 dev:加载 packages/agent/.env(cwd=包根);线上由部署环境注入。

import type { Message, RunAgentInput } from '@ag-ui/core';
import { sse } from '@incipel/shared';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authenticate, AuthError } from './auth';
import { generateLogline } from './logline';
import { runTurnCore } from './run';
import { createStore, type Store } from './store';
import { MemoryStore } from './dev/memory-store';

export const app = new Hono();

// ── 本地 dev 开关(仅本地试用;prod 绝不开)────────────────────────────────────
// DEV_NO_AUTH=1:跳过 Supabase JWT 校验,用固定 dev 用户。
// STORE=memory:用进程级内存 store,免依赖 Supabase schema(多轮在进程内持续,重启即丢)。
const DEV_NO_AUTH = process.env.DEV_NO_AUTH === '1';
const DEV_USER_ID = 'dev-user';
const memoryStore: Store | null = process.env.STORE === 'memory' ? new MemoryStore() : null;
function getStore(): Store {
  return memoryStore ?? createStore();
}

// ── /health ────────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, service: 'incipel-agent' }));

const LoglineBody = z.object({
  // 可选:有灵感则据此偏置,空输入(没头绪时点骰子)则随机生成一句全新 logline。
  idea: z.string().optional(),
});

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

  let input: RunAgentInput;
  try {
    input = (await c.req.json()) as RunAgentInput;
  } catch (err) {
    return c.json({ error: `请求体不合法: ${(err as Error).message}` }, 400);
  }

  const threadId = input.threadId;
  if (typeof threadId !== 'string' || !threadId) {
    return c.json({ error: 'RunAgentInput.threadId 缺失' }, 400);
  }
  const runId = typeof input.runId === 'string' && input.runId ? input.runId : nanoid();

  const userMessage = lastUserText(input.messages);
  if (!userMessage) {
    return c.json({ error: 'messages 中没有可用的 user 消息' }, 400);
  }

  // forwardedProps 可带新建会话用的 accent / title,以及自定义的助手显示名 assistantName。
  const fp = (input.forwardedProps ?? {}) as {
    accent?: string;
    title?: string;
    assistantName?: string;
  };
  // 助手显示名:客户端传入则用之,否则走默认「主管编剧」(在 prompt 层兜底)。
  // 这是「用户自定义助手名」的服务端入口;日后可改为按会话/用户持久化读取。
  const assistantName = typeof fp.assistantName === 'string' ? fp.assistantName : undefined;

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

  let body;
  try {
    body = LoglineBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: `请求体不合法: ${(err as Error).message}` }, 400);
  }

  try {
    const result = await generateLogline({ idea: body.idea });
    return c.json(result);
  } catch (err) {
    return c.json({ error: `生成 logline 失败: ${(err as Error).message}` }, 502);
  }
});

// ── 本地 Node 启动块 ──────────────────────────────────────────────────────────
// 仅在以 Node 直接运行本文件时生效(dev / 专用主机)。Edge Function(Deno)下用
// `Deno.serve(app.fetch)`,不会走到这里。
// 用动态 import 隔离 @hono/node-server,避免 Deno 解析 Node-only 依赖。
if (typeof process !== 'undefined' && process.env.INCIPEL_RUNTIME !== 'edge') {
  const port = Number(process.env.PORT ?? 8787);
  void import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port });
    // eslint-disable-next-line no-console
    console.log(`[incipel-agent] listening on http://localhost:${port}`);
  });
}
