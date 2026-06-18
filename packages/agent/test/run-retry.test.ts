// KI-1 回归测试:重试循环按尝试隔离状态与流式输出。
// 用伪 provider + MemoryStore 离线跑 runTurnCore,无需真实模型或数据库。

import { describe, it, expect } from 'vitest';
import { EventType, type JsonPatchOp, type Screenplay } from '@incipel/shared';
import { runTurnCore } from '../src/run';
import { MemoryStore } from '../src/dev/memory-store';
import { fakeProvider, throwStep } from './helpers/fake-provider';
import { applyPatch } from './helpers/apply-patch';

type Ev = Record<string, any>;

async function collect(gen: AsyncGenerator<unknown>): Promise<Ev[]> {
  const events: Ev[] = [];
  for await (const e of gen) events.push(e as Ev);
  return events;
}

describe('KI-1 重试按尝试隔离', () => {
  it('失败尝试已 add 的实体不残留:重试成功后只落一个人物', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't1', userId: 'u1' });
    const provider = fakeProvider([
      // attempt 1:add 一个人物后抛错。
      [
        { type: 'tool-call', call: { toolCallId: 'a', toolName: 'add_character', args: { name: '林深', note: '' } } },
        throwStep('boom'),
      ],
      // attempt 2:重发同一 add 并收尾。
      [
        { type: 'tool-call', call: { toolCallId: 'b', toolName: 'add_character', args: { name: '林深', note: '' } } },
        { type: 'text', delta: '立了林深。' },
      ],
    ]);

    const events = await collect(
      runTurnCore(
        { threadId: 't1', runId: 'r1', userId: 'u1', userMessage: '帮我立个人物', newConnection: true },
        { provider, store },
      ),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_FINISHED);
    expect(types).not.toContain(EventType.RUN_ERROR);

    // 修复前:state 跨尝试累加 → 2 个重复人物;修复后克隆 + 提交 → 恰好 1 个。
    const saved = store.lastSaved!;
    expect(saved.state.characters).toHaveLength(1);
    expect(saved.state.characters[0]!.name).toBe('林深');
  });

  it('重试补发干净基线 STATE_SNAPSHOT,且客户端重放事件 == 落库 state', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't2', userId: 'u1' });
    const provider = fakeProvider([
      [
        { type: 'tool-call', call: { toolCallId: 'a', toolName: 'add_character', args: { name: '弃用', note: '' } } },
        throwStep(),
      ],
      [
        { type: 'tool-call', call: { toolCallId: 'b', toolName: 'add_character', args: { name: '阿七', note: '少年' } } },
        { type: 'text', delta: '立了阿七。' },
      ],
    ]);

    const events = await collect(
      runTurnCore(
        { threadId: 't2', runId: 'r2', userId: 'u1', userMessage: 'x', newConnection: true },
        { provider, store },
      ),
    );

    // 开局基线 + 失败后纠偏基线,至少两条 STATE_SNAPSHOT。
    const snaps = events.filter((e) => e.type === EventType.STATE_SNAPSHOT);
    expect(snaps.length).toBeGreaterThanOrEqual(2);

    // 客户端按收到的事件重放:STATE_SNAPSHOT 全量覆盖,STATE_DELTA 打补丁。
    let client: Screenplay | null = null;
    for (const e of events) {
      if (e.type === EventType.STATE_SNAPSHOT) client = structuredClone(e.snapshot as Screenplay);
      else if (e.type === EventType.STATE_DELTA) client = applyPatch(client!, e.delta as JsonPatchOp[]);
    }
    expect(client).toEqual(store.lastSaved!.state);
    expect(client!.characters.map((c) => c.name)).toEqual(['阿七']);
  });

  it('失败尝试已吐文本时:整轮仅一条 TEXT_MESSAGE_START,不产生重复气泡', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't4', userId: 'u1' });
    const provider = fakeProvider([
      // attempt 1:先流式吐文本,再抛错。
      [{ type: 'text', delta: '让我想想…' }, throwStep()],
      // attempt 2:写人物并收尾。
      [
        { type: 'tool-call', call: { toolCallId: 'b', toolName: 'add_character', args: { name: '阿七', note: '' } } },
        { type: 'text', delta: '立了阿七。' },
      ],
    ]);

    const events = await collect(
      runTurnCore(
        { threadId: 't4', runId: 'r4', userId: 'u1', userMessage: 'x', newConnection: true },
        { provider, store },
      ),
    );

    // 单一 messageId、整轮唯一一条 START/END:失败尝试的残文不会被定稿成第二条气泡。
    const starts = events.filter((e) => e.type === EventType.TEXT_MESSAGE_START);
    const ends = events.filter((e) => e.type === EventType.TEXT_MESSAGE_END);
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]!.messageId).toBe(ends[0]!.messageId);
    expect(events.map((e) => e.type)).toContain(EventType.RUN_FINISHED);

    // 落库只含成功尝试的文本与人物。
    expect(store.lastSaved!.assistantText).toBe('立了阿七。');
    expect(store.lastSaved!.state.characters).toHaveLength(1);
  });

  it('两次都失败 → RUN_ERROR{MODEL_FAILED} 且不落库', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't3', userId: 'u1' });
    const provider = fakeProvider([[throwStep('e1')], [throwStep('e2')]]);

    const events = await collect(
      runTurnCore(
        { threadId: 't3', runId: 'r3', userId: 'u1', userMessage: 'x', newConnection: true },
        { provider, store },
      ),
    );

    const err = events.find((e) => e.type === EventType.RUN_ERROR);
    expect(err?.code).toBe('MODEL_FAILED');
    expect(events.map((e) => e.type)).not.toContain(EventType.RUN_FINISHED);
    expect(store.savedTurnCount).toBe(0);
  });
});
