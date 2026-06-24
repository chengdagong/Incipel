// stub provider(MODEL_PROVIDER=stub)端到端核对:把真实 createStubProvider 注入 runTurnCore,
// 确认它走同一条核心循环、产出可被 apply/save 的确定性的一轮(供 Maestro 创作主路径 E2E 依赖)。
// 与 run-orchestration.test.ts 同构:注入 provider + MemoryStore,断言事件与落进数据库产物。

import { describe, it, expect } from 'vitest';
import { EventType } from '@incipel/shared';
import { runTurnCore } from '../src/run';
import { MemoryStore } from '../src/dev/memory-store';
import { createStubProvider, STUB_ERROR_TOKEN } from '../src/model/stub';

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
  userMessage: '我想写一个深夜来电的故事',
  newConnection: true,
  ...over,
});

describe('createStubProvider — 一轮确定性创作', () => {
  it('一轮:文字 + 设 meta + 建人物「林夏」+ options,均落进数据库', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });

    const events = await collect(runTurnCore(input(), { provider: createStubProvider(), store }));
    const types = events.map((e) => e.type);

    // 走完整核心循环:开局快照 → 文本 → 增量 → options → 结束,无错误。
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types).toContain(EventType.STATE_SNAPSHOT);
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
    expect(types).toContain(EventType.STATE_DELTA);
    expect(types).toContain(EventType.CUSTOM); // propose_options
    expect(types).toContain(EventType.RUN_FINISHED);
    expect(types).not.toContain(EventType.RUN_ERROR);

    const saved = store.lastSaved!;
    expect(saved.changed).toBe(true);
    expect(saved.assistantText).toBe('我先把这个开头立起来——给你标题、一句 logline,再搭一个核心人物。');
    expect(saved.options).toEqual(['先挖她的过去', '让电话那头先开口']);

    // meta + 人物确定性:标题/logline 已设,建出唯一人物「林夏」并带两条属性。
    expect(saved.state.meta.title).toBe('深夜来电');
    expect(saved.state.meta.logline).toBeTruthy();
    expect(saved.state.characters).toHaveLength(1);
    const lin = saved.state.characters[0]!;
    expect(lin.name).toBe('林夏');
    expect(lin.attrs.map((a) => a.label)).toEqual(['外貌', '处境']);
  });

  it('completeLogline 返回固定非空 logline(欢迎页骰子离线可用)', async () => {
    const logline = await createStubProvider().completeLogline({ prompt: 'p' });
    expect(logline.trim().length).toBeGreaterThan(0);
  });

  it('灵感里带暗号 → 抛错 → 经重试后发 RUN_ERROR(供 error-retry flow)', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });

    const events = await collect(
      runTurnCore(input({ userMessage: `写个故事 ${STUB_ERROR_TOKEN}` }), {
        provider: createStubProvider(),
        store,
      }),
    );
    const types = events.map((e) => e.type);

    // 暗号轮:落到 RUN_ERROR(code=MODEL_FAILED),不发 RUN_FINISHED,也不写入数据库(无内容可编造)。
    expect(types).toContain(EventType.RUN_ERROR);
    expect(types).not.toContain(EventType.RUN_FINISHED);
    const errEv = events.find((e) => e.type === EventType.RUN_ERROR)!;
    expect(errEv.code).toBe('MODEL_FAILED');
    expect(store.lastSaved).toBeNull();
  });
});
