// 选项输出 integration 测试:
// 1. runTurnCore 传给 provider 的 system prompt 含有可点选项只走 propose_options 的约束。
// 2. 人物 STATE_DELTA 先发,轮末再发 CUSTOM options;助手正文与保存结果都不重复写选项文本。

import { describe, expect, it } from 'vitest';
import { EventType, OPTIONS_EVENT_NAME } from '@incipel/shared';
import { runTurnCore } from '../src/run';
import { MemoryStore } from '../src/dev/memory-store';
import type { CompleteLoglineInput, ModelProvider, StreamChunk, StreamTurnInput } from '../src/model/provider';

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
  userMessage: '先立两个人物,再给我下一步选项。',
  newConnection: true,
  ...over,
});

function recordingProvider(script: StreamChunk[], seen: StreamTurnInput[]): ModelProvider {
  return {
    async *streamTurn(turnInput: StreamTurnInput): AsyncIterable<StreamChunk> {
      seen.push(turnInput);
      for (const chunk of script) yield chunk;
    },
    async completeLogline(_input: CompleteLoglineInput): Promise<string> {
      return '一句测试 logline';
    },
  };
}

function assistantText(events: Ev[]): string {
  return events
    .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
    .map((event) => String(event.delta ?? ''))
    .join('');
}

function firstIndex(events: Ev[], predicate: (event: Ev) => boolean): number {
  return events.findIndex(predicate);
}

describe('agent options output integration', () => {
  it('传给 provider 的 system prompt 要求可点选项只通过 propose_options 发出', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const seen: StreamTurnInput[] = [];
    const provider = recordingProvider([{ type: 'text', delta: '我先给你两个方向。' }], seen);

    await collect(runTurnCore(input(), { provider, store }));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toContain('可点选项只通过 propose_options 发出');
    expect(seen[0]!.system).toContain('不要把可点选项写进回复文本');
    expect(seen[0]!.system).toContain('propose_options(options):本次回复可点选项');
  });

  it('人物改动先作为 STATE_DELTA 发出,选项在轮末作为 CUSTOM options 发出', async () => {
    const store = new MemoryStore();
    await store.createSessionIfMissing({ threadId: 't', userId: 'u' });
    const options = ['先写世界规则', '先写三幕大纲', '先写林岑误入游戏'];
    const seen: StreamTurnInput[] = [];
    const provider = recordingProvider(
      [
        { type: 'text', delta: '我先把两个核心人物立起来,下一步你选一个方向。' },
        {
          type: 'tool-call',
          call: {
            toolCallId: 'char-1',
            toolName: 'add_character',
            args: {
              name: '林岑',
              role: '失业失恋、濒临轻生的年轻人',
              attrs: [
                { label: '身份', value: '主角' },
                { label: '年龄', value: '26 岁' },
                { label: '性别', value: '男' },
              ],
            },
          },
        },
        {
          type: 'tool-call',
          call: {
            toolCallId: 'char-2',
            toolName: 'add_character',
            args: {
              name: '阿屿',
              role: '人生模拟游戏里的 AI 人物',
              attrs: [
                { label: '身份', value: '主角' },
                { label: '背景', value: '被困在一次次充值与重置之间。' },
              ],
            },
          },
        },
        { type: 'tool-call', call: { toolCallId: 'options-1', toolName: 'propose_options', args: { options } } },
      ],
      seen,
    );

    const events = await collect(runTurnCore(input(), { provider, store }));
    const text = assistantText(events);
    const characterDeltaIndexes = events.flatMap((event, index) => {
      if (event.type !== EventType.STATE_DELTA) return [];
      const paths = Array.isArray(event.delta) ? event.delta.map((op: { path?: unknown }) => String(op.path ?? '')) : [];
      return paths.some((path) => path.startsWith('/characters/')) ? [index] : [];
    });
    const optionsIndex = firstIndex(
      events,
      (event) => event.type === EventType.CUSTOM && event.name === OPTIONS_EVENT_NAME,
    );

    expect(seen).toHaveLength(1);
    expect(characterDeltaIndexes).toHaveLength(2);
    expect(optionsIndex).toBeGreaterThan(Math.max(...characterDeltaIndexes));
    expect(events[optionsIndex]!.value).toEqual(options);
    expect(text).toBe('我先把两个核心人物立起来,下一步你选一个方向。');
    for (const option of options) {
      expect(text).not.toContain(option);
    }

    const saved = store.lastSaved!;
    expect(saved.state.characters.map((character) => character.name)).toEqual(['林岑', '阿屿']);
    expect(saved.options).toEqual(options);
    expect(saved.assistantText).toBe(text);
    for (const option of options) {
      expect(saved.assistantText).not.toContain(option);
    }
  });
});
