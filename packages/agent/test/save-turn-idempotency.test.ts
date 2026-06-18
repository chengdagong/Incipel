// KI-2 回归测试(store 层):runId 经 runTurnCore 透传到 saveTurn,同 runId 重发不重复落库。
// 真正的 DB 层幂等(save_turn)在 supabase/tests/reliability_test.sql 用 pgTAP 验证。

import { describe, it, expect } from 'vitest';
import { EventType } from '@incipel/shared';
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

  it('已落库的 runId 重发:在调用模型前重放,不再跑模型(Codex P1)', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });

    // 先正常跑一轮 r5 并落库:写一个人物 + 一句总结。
    const okProvider = fakeProvider([
      [
        { type: 'tool-call', call: { toolCallId: 'a', toolName: 'add_character', args: { name: '阿七', note: '' } } },
        { type: 'text', delta: '立了阿七。' },
      ],
    ]);
    const first: Record<string, any>[] = [];
    for await (const e of runTurnCore({ threadId: 't', runId: 'r5', userId: 'u', userMessage: 'm', newConnection: true }, { provider: okProvider, store })) {
      first.push(e as Record<string, any>);
    }

    // 同一 runId 重发:provider 一旦被调用就抛错;断言重放成功且模型未被调用。
    let called = false;
    const guard = {
      async *streamTurn() {
        called = true;
        throw new Error('模型不应被调用(应走幂等重放)');
        // eslint-disable-next-line no-unreachable
        yield undefined as never;
      },
      async completeLogline() {
        return '';
      },
    };
    const replay: Record<string, any>[] = [];
    for await (const e of runTurnCore({ threadId: 't', runId: 'r5', userId: 'u', userMessage: 'm', newConnection: true }, { provider: guard, store })) {
      replay.push(e as Record<string, any>);
    }

    expect(called).toBe(false);
    const types = replay.map((e) => e.type);
    expect(types).toContain(EventType.RUN_FINISHED);
    expect(types).not.toContain(EventType.RUN_ERROR);
    // 重放不产生新的 STATE_DELTA(模型没跑),且不再落库。
    expect(types).not.toContain(EventType.STATE_DELTA);
    expect(store.savedTurnCount).toBe(1);
    // 重放的助手文本等于首次落库的文本。
    const replayText = replay
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta)
      .join('');
    expect(replayText).toBe('立了阿七。');
  });
});
