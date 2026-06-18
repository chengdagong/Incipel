// KI-2 回归测试(store 层):runId 经 runTurnCore 透传到 saveTurn,同 runId 重发不重复落库。
// 真正的 DB 层幂等(save_turn)在 supabase/tests/reliability_test.sql 用 pgTAP 验证。

import { describe, it, expect } from 'vitest';
import { runTurnCore } from '../src/run';
import { MemoryStore } from '../src/dev/memory-store';
import { fakeProvider } from './helpers/fake-provider';

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    /* consume */
  }
}

const SUCCESS = [
  [
    { type: 'tool-call', call: { toolCallId: 'a', toolName: 'add_character', args: { name: 'A', note: '' } } },
    { type: 'text', delta: 'ok' },
  ],
] as const;

describe('KI-2 落库幂等', () => {
  it('同一 runId 重发,只落库一次', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = fakeProvider(SUCCESS as never);

    await drain(runTurnCore({ threadId: 't', runId: 'same', userId: 'u', userMessage: 'm', newConnection: true }, { provider, store }));
    await drain(runTurnCore({ threadId: 't', runId: 'same', userId: 'u', userMessage: 'm', newConnection: true }, { provider, store }));

    expect(store.savedTurnCount).toBe(1);
  });

  it('不同 runId 各自落库', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = fakeProvider(SUCCESS as never);

    await drain(runTurnCore({ threadId: 't', runId: 'r1', userId: 'u', userMessage: 'm', newConnection: true }, { provider, store }));
    await drain(runTurnCore({ threadId: 't', runId: 'r2', userId: 'u', userMessage: 'm', newConnection: true }, { provider, store }));

    expect(store.savedTurnCount).toBe(2);
  });
});
