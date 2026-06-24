// 内存版 Store:供冒烟脚本(smoke-turn.ts)跑真实一轮而不依赖 Supabase。
// 实现 store.ts 的 Store 接口;saveTurn 把本轮结果留在内存里供脚本断言/打印。

import { emptyScreenplay, type Screenplay } from '@incipel/shared';
import type { PromptMessage } from '../prompt.ts';
import type { CreateSessionInput, LoadedSession, SaveTurnInput, SavedTurn, Store } from '../store.ts';

type MemSession = {
  userId: string;
  state: Screenplay;
  messages: PromptMessage[];
};

export class MemoryStore implements Store {
  private readonly sessions = new Map<string, MemSession>();
  // 已写入数据库的 run:runId -> 该轮结果,用作幂等键与重放源(与线上 save_turn / findSavedTurn 保持一致,见 KI-2)。
  private readonly savedRuns = new Map<string, SavedTurn>();
  // 最近一次 saveTurn 的载荷,供脚本检查写入数据库内容。
  public lastSaved: SaveTurnInput | null = null;
  // 累计 saveTurn 实际生效的次数(被幂等跳过的不计),供测试断言重发不重复写入数据库。
  public savedTurnCount = 0;

  async loadSession(threadId: string, userId: string): Promise<LoadedSession> {
    const s = this.sessions.get(threadId);
    if (!s) throw new Error(`会话不存在: ${threadId}`);
    if (s.userId !== userId) throw new Error('会话不属于该用户');
    return {
      threadId,
      userId: s.userId,
      // 返回引用:核心循环就地推进同一内存剧本(与线上一致)。
      state: s.state,
      // 完整对话历史(ADR-0010):返回全部消息,不截断。
      history: s.messages.slice(),
    };
  }

  async createSessionIfMissing(input: CreateSessionInput): Promise<void> {
    if (this.sessions.has(input.threadId)) return;
    this.sessions.set(input.threadId, {
      userId: input.userId,
      state: emptyScreenplay(input.accent),
      messages: [],
    });
  }

  async saveTurn(input: SaveTurnInput): Promise<void> {
    const s = this.sessions.get(input.threadId);
    if (!s) throw new Error(`会话不存在: ${input.threadId}`);
    // 幂等:同一 runId 重发不重复写入数据库(见 KI-2)。
    if (this.savedRuns.has(input.runId)) {
      this.lastSaved = input;
      return;
    }
    this.savedRuns.set(input.runId, { assistantText: input.assistantText, options: input.options });
    s.state = input.state;
    if (input.userText) s.messages.push({ role: 'user', text: input.userText });
    s.messages.push({ role: 'assistant', text: input.assistantText });
    this.lastSaved = input;
    this.savedTurnCount += 1;
  }

  async findSavedTurn(threadId: string, runId: string): Promise<SavedTurn | null> {
    void threadId; // 内存版按 runId 直接索引;线上版按 (session_id, run_id) 查
    return this.savedRuns.get(runId) ?? null;
  }
}
