// 数据层访问(seam)。一轮的核心循环(run.ts 的 runTurnCore)只依赖 Store 接口,既能注入
// Supabase 实现(线上),也能注入内存实现(冒烟脚本,见 dev/smoke-turn.ts)。
//
// threadId 即会话标识(等同 session id):据它从 documents.state 载入权威剧本;无则建会话与
// 空剧本。权威剧本以 DB 为准,不信任 input.state。
//
// agent 以 Supabase service role 连接 Postgres——它已自行校验 JWT 与归属(见 auth.ts、
// system-design §8),故绕过 RLS 是有意的。
//
// 一轮结束的原子落库走 Postgres 函数 save_turn(跨包契约,由数据层包定义):
//   save_turn(p_session_id, p_run_id, p_user_text, p_assistant_text,
//             p_deltas, p_options, p_state, p_changed) returns void
// 行为:插入 user / assistant messages;更新 documents.state 与 sessions.updated_at;
//       p_changed 为真时另写一条 document_versions(turn_index = 该会话最大值 + 1)。
// p_run_id 是幂等键:同一 run 重发不重复插 messages / version(见 docs/known-issues.md KI-2);
// 函数内取会话级 advisory lock 串行化 turn_index 计算,杜绝并发竞争(见 KI-3)。

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  emptyScreenplay,
  normalizeScreenplay,
  type JsonPatchOp,
  type Screenplay,
} from '@incipel/shared';
import type { PromptMessage } from './prompt';

export type LoadedSession = {
  threadId: string;
  userId: string;
  // 权威剧本(以 DB 为准)。
  state: Screenplay;
  // 最近 N 条消息,按时间正序(早 -> 晚)。
  recent: PromptMessage[];
};

export type CreateSessionInput = {
  threadId: string;
  userId: string;
  title?: string;
  accent?: string;
};

export type SaveTurnInput = {
  threadId: string;
  // 本轮 run 标识,作幂等键:重发同一轮不重复落库(见 docs/known-issues.md KI-2)。
  runId: string;
  userText: string;
  assistantText: string;
  deltas: JsonPatchOp[];
  options: string[];
  state: Screenplay;
  // 本轮剧本是否有改动;为真才写 document_versions。
  changed: boolean;
};

// 某一 run 已落库的结果(幂等重放用,见 docs/known-issues.md KI-2 与 Codex 评审 P1)。
export type SavedTurn = {
  assistantText: string;
  options: string[];
};

// 一轮核心循环依赖的数据层契约(seam)。
export interface Store {
  // 据 threadId 载入权威剧本与最近对话。会话必须存在且属于该 userId。
  loadSession(threadId: string, userId: string, recentLimit?: number): Promise<LoadedSession>;
  // 若该 threadId 尚无会话则建会话 + 空剧本(forwardedProps 可带 accent/title);已存在则不动。
  createSessionIfMissing(input: CreateSessionInput): Promise<void>;
  // 一轮结束的原子落库,调用 save_turn RPC。
  saveTurn(input: SaveTurnInput): Promise<void>;
  // 查询某 run 是否已落库(幂等重放用):已落则返回其助手文本与本轮 options,否则 null。
  // 让重发同一 runId 的请求在调用模型前就被识别、直接重放已落库结果,而非重跑模型再被去重。
  findSavedTurn(threadId: string, runId: string): Promise<SavedTurn | null>;
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

// ── Supabase 实现 ────────────────────────────────────────────────────────────

let client: SupabaseClient | null = null;

// 单例:service role 客户端。不自动持久化会话(服务端无浏览器存储语义)。
export function getServiceClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export class SupabaseStore implements Store {
  // 取 documents.state 与最近 N 条 messages。校验 session 归属传入的 userId。
  async loadSession(threadId: string, userId: string, recentLimit = 10): Promise<LoadedSession> {
    const db = getServiceClient();

    // 归属校验:session 必须属于该用户。
    const { data: session, error: sErr } = await db
      .from('sessions')
      .select('id, user_id')
      .eq('id', threadId)
      .single();
    if (sErr) throw new StoreError(`加载会话失败: ${sErr.message}`);
    if (!session || session.user_id !== userId) {
      throw new StoreError('会话不存在或不属于该用户');
    }

    // 当前剧本。documents 与 session 1:1。用 maybeSingle 容忍「会话存在但剧本行缺失」
    // 的情形(见 KI-5):缺失时退回空剧本而非整轮报错。正常路径下 createSessionIfMissing
    // 已把该行原子建好或补齐。
    const { data: doc, error: dErr } = await db
      .from('documents')
      .select('state')
      .eq('session_id', threadId)
      .maybeSingle();
    if (dErr) throw new StoreError(`加载剧本失败: ${dErr.message}`);

    // 归一:documents.state 是 opaque jsonb,改过人物形态(note → role+attrs)后,旧行的人物可能缺
    // attrs/role;载入即补齐,避免本轮 idSetsOf/serializeScreenplay 对 undefined 取属性而崩(见评审 #1)。
    const state = normalizeScreenplay((doc?.state as Screenplay | null) ?? emptyScreenplay());

    // 最近 N 条消息:DB 取最新 N 条(倒序),再翻成正序给 prompt 用。
    const { data: rows, error: mErr } = await db
      .from('messages')
      .select('role, text, created_at')
      .eq('session_id', threadId)
      .order('created_at', { ascending: false })
      .limit(recentLimit);
    if (mErr) throw new StoreError(`加载消息失败: ${mErr.message}`);

    const recent: PromptMessage[] = (rows ?? [])
      .slice()
      .reverse()
      .map((r) => ({
        role: r.role === 'assistant' ? 'assistant' : 'user',
        text: String(r.text ?? ''),
      }));

    return { threadId, userId: session.user_id, state, recent };
  }

  // 若该 threadId 尚无会话:原子地建 sessions 行 + 与之 1:1 的 documents 行(初始空剧本)。
  // 走 create_session_if_missing RPC,把两次插入放进一个事务并 ON CONFLICT DO NOTHING:
  //  · 原子——杜绝「建了会话、没建剧本」的卡死会话(见 docs/known-issues.md KI-5);
  //  · 幂等——已存在则不动,且会补齐缺失的 documents 行;
  //  · 归属校验在 RPC 内完成(会话已存在且不属于该用户即抛错)。
  async createSessionIfMissing(input: CreateSessionInput): Promise<void> {
    const db = getServiceClient();
    const state = emptyScreenplay(input.accent);
    const { error } = await db.rpc('create_session_if_missing', {
      p_session_id: input.threadId,
      p_user_id: input.userId,
      p_title: input.title ?? '',
      p_accent: state.meta.accent,
      p_state: state,
    });
    if (error) throw new StoreError(`创建会话失败: ${error.message}`);
  }

  // 一轮结束的原子落库,调用 save_turn RPC(跨包契约,签名不变)。
  async saveTurn(input: SaveTurnInput): Promise<void> {
    const db = getServiceClient();
    const { error } = await db.rpc('save_turn', {
      p_session_id: input.threadId,
      p_run_id: input.runId,
      p_user_text: input.userText,
      p_assistant_text: input.assistantText,
      p_deltas: input.deltas,
      p_options: input.options,
      p_state: input.state,
      p_changed: input.changed,
    });
    if (error) throw new StoreError(`落库失败 (save_turn): ${error.message}`);
  }

  // 据 (session_id, run_id) 查该 run 的 assistant 消息;存在即说明本轮已落库。
  // save_turn 的幂等保证同一 run 至多一条 assistant 消息(messages_session_run_idx 支持此查询)。
  async findSavedTurn(threadId: string, runId: string): Promise<SavedTurn | null> {
    const db = getServiceClient();
    const { data, error } = await db
      .from('messages')
      .select('text, options')
      .eq('session_id', threadId)
      .eq('run_id', runId)
      .eq('role', 'assistant')
      .limit(1);
    if (error) throw new StoreError(`查询已落库轮失败: ${error.message}`);
    const row = data?.[0];
    if (!row) return null;
    return {
      assistantText: String(row.text ?? ''),
      options: Array.isArray(row.options) ? (row.options as string[]) : [],
    };
  }
}

// 默认 Store(线上用 Supabase)。
export function createStore(): Store {
  return new SupabaseStore();
}
