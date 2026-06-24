// run.ts runTurnCore 编排测试(testing-strategy §3.3):事件顺序、无文本路径、options/changed、错误码。
// 重试隔离见 run-retry.test.ts;幂等重放见 save-turn-idempotency.test.ts。

import { describe, it, expect } from 'vitest';
import { EventType } from '@incipel/shared';
import { runTurnCore } from '../src/run';
import { MemoryStore } from '../src/dev/memory-store';
import { stubProvider } from './helpers/stub-provider';

type Ev = Record<string, any>;
async function collect(gen: AsyncGenerator<unknown>): Promise<Ev[]> {
  const out: Ev[] = [];
  for await (const e of gen) out.push(e as Ev);
  return out;
}
const input = (over: Partial<Record<string, any>> = {}) => ({
  threadId: 't',
  runId: 'r',
  userId: 'u',
  userMessage: 'm',
  newConnection: true,
  ...over,
});

describe('runTurnCore — 事件顺序与产物', () => {
  it('RUN_STARTED → STATE_SNAPSHOT → 文本/增量 → options → RUN_FINISHED', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([
      [
        { type: 'text', delta: '你好' },
        { type: 'tool-call', call: { toolCallId: '1', toolName: 'add_character', args: { name: 'A', note: '' } } },
        { type: 'tool-call', call: { toolCallId: '2', toolName: 'propose_options', args: { options: ['x', 'y'] } } },
      ],
    ]);
    const types = (await collect(runTurnCore(input(), { provider, store }))).map((e) => e.type);
    expect(types).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.STATE_DELTA,
      EventType.TEXT_MESSAGE_END,
      EventType.CUSTOM, // options
      EventType.RUN_FINISHED,
    ]);

    const saved = store.lastSaved!;
    expect(saved.assistantText).toBe('你好');
    expect(saved.changed).toBe(true);
    expect(saved.options).toEqual(['x', 'y']);
  });

  it('本轮无文本(纯接管):不发 TEXT_MESSAGE_START/END', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([
      [{ type: 'tool-call', call: { toolCallId: '1', toolName: 'add_character', args: { name: 'A', note: '' } } }],
    ]);
    const types = (await collect(runTurnCore(input(), { provider, store }))).map((e) => e.type);
    expect(types).not.toContain(EventType.TEXT_MESSAGE_START);
    expect(types).not.toContain(EventType.TEXT_MESSAGE_END);
    expect(types).toContain(EventType.STATE_DELTA);
    expect(store.lastSaved!.changed).toBe(true);
    expect(store.lastSaved!.assistantText).toBe('');
  });

  it('纯引导(只 propose_options,没改剧本):无 STATE_DELTA,changed=false,有 options', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([
      [
        { type: 'text', delta: '你想往哪个方向走?' },
        { type: 'tool-call', call: { toolCallId: '1', toolName: 'propose_options', args: { options: ['悬疑', '温情'] } } },
      ],
    ]);
    const events = await collect(runTurnCore(input(), { provider, store }));
    const types = events.map((e) => e.type);
    expect(types).not.toContain(EventType.STATE_DELTA);
    expect(types).toContain(EventType.CUSTOM);
    expect(types).toContain(EventType.RUN_FINISHED);
    expect(store.lastSaved!.changed).toBe(false);
    expect(store.lastSaved!.options).toEqual(['悬疑', '温情']);
  });

  it('options 最多 3 个(propose_options 超出被截断)', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([
      [{ type: 'tool-call', call: { toolCallId: '1', toolName: 'propose_options', args: { options: ['a', 'b', 'c', 'd'] } } }],
    ]);
    await collect(runTurnCore(input(), { provider, store }));
    expect(store.lastSaved!.options).toEqual(['a', 'b', 'c']);
  });

  it('tool-call-start chunk 被消费但不外发 TOOL_CALL_* 事件(内部工具由服务端执行)', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([
      [
        { type: 'tool-call-start', toolCallId: '1', toolName: 'add_character' },
        { type: 'tool-call', call: { toolCallId: '1', toolName: 'add_character', args: { name: 'A', note: '' } } },
        { type: 'text', delta: 'ok' },
      ],
    ]);
    const events = await collect(runTurnCore(input(), { provider, store }));
    expect(events.some((e) => String(e.type).toUpperCase().includes('TOOL_CALL'))).toBe(false);
    expect(events.map((e) => e.type)).toContain(EventType.RUN_FINISHED);
    expect(store.lastSaved!.state.characters).toHaveLength(1);
  });

  it('newConnection=false:不发开局 STATE_SNAPSHOT', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([[{ type: 'text', delta: 'hi' }]]);
    const types = (await collect(runTurnCore(input({ newConnection: false }), { provider, store }))).map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types).not.toContain(EventType.STATE_SNAPSHOT);
  });
});

describe('runTurnCore — 错误路径', () => {
  it('loadSession 抛错 → RUN_ERROR{LOAD_FAILED} 且不写入数据库', async () => {
    const store = new MemoryStore(); // 未建会话 → loadSession 抛错
    const provider = stubProvider([[{ type: 'text', delta: 'hi' }]]);
    const events = await collect(runTurnCore(input({ threadId: 'missing' }), { provider, store }));
    const err = events.find((e) => e.type === EventType.RUN_ERROR);
    expect(err?.code).toBe('LOAD_FAILED');
    expect(events.map((e) => e.type)).not.toContain(EventType.RUN_FINISHED);
    expect(store.savedTurnCount).toBe(0);
  });

  it('saveTurn 抛错 → RUN_ERROR{PERSIST_FAILED}', async () => {
    class FailSave extends MemoryStore {
      override async saveTurn(): Promise<void> {
        throw new Error('db down');
      }
    }
    const store = new FailSave();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const provider = stubProvider([[{ type: 'text', delta: 'hi' }]]);
    const events = await collect(runTurnCore(input(), { provider, store }));
    const err = events.find((e) => e.type === EventType.RUN_ERROR);
    expect(err?.code).toBe('PERSIST_FAILED');
  });
});
