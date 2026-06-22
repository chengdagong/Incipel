// ai-sdk-runtime.ts 单元测试(testing-strategy §3.6):把 ai SDK 的 fullStream part 翻译成 StreamChunk。
// mock 掉 'ai' 的 streamText/tool,喂伪 fullStream,断言翻译正确、error part 被抛出。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StreamChunk } from '../src/model/provider';

// 用 vi.hoisted 共享可变状态,供 mock 工厂与测试读写(vi.mock 会被提升到顶部)。
const h = vi.hoisted(() => ({
  fullStreamParts: [] as any[],
  textChunks: [] as string[],
  lastArgs: null as any,
}));

vi.mock('ai', () => ({
  // tool() 在本实现里只是把 {parameters, execute} 透传;mock 成恒等即可。
  tool: (def: any) => def,
  streamText: (args: any) => {
    h.lastArgs = args;
    return {
      get fullStream() {
        return (async function* () {
          for (const p of h.fullStreamParts) yield p;
        })();
      },
      get textStream() {
        return (async function* () {
          for (const c of h.textChunks) yield c;
        })();
      },
    };
  },
}));

beforeEach(() => {
  h.fullStreamParts = [];
  h.textChunks = [];
  h.lastArgs = null;
});

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('makeAiSdkProvider.streamTurn — fullStream 翻译', () => {
  it('text-delta/tool-call-streaming-start/tool-call 各类 part 正确翻译,未知 part 忽略', async () => {
    const { makeAiSdkProvider } = await import('../src/model/ai-sdk-runtime');
    h.fullStreamParts = [
      { type: 'text-delta', textDelta: '你好' },
      { type: 'tool-call-streaming-start', toolCallId: '1', toolName: 'add_character' },
      { type: 'tool-call', toolCallId: '1', toolName: 'add_character', args: { name: '林深' } },
      { type: 'step-finish' }, // 未知 part:应被忽略
    ];
    const provider = makeAiSdkProvider(() => ({}) as any);
    const chunks = await collect(provider.streamTurn({ system: 'sys', prompt: 'p', tools: {} }));
    expect(chunks).toEqual([
      { type: 'text', delta: '你好' },
      { type: 'tool-call-start', toolCallId: '1', toolName: 'add_character' },
      { type: 'tool-call', call: { toolCallId: '1', toolName: 'add_character', args: { name: '林深' } } },
    ]);
  });

  it('error part → 抛出该错误(交给 run.ts 重试/RUN_ERROR)', async () => {
    const { makeAiSdkProvider } = await import('../src/model/ai-sdk-runtime');
    h.fullStreamParts = [
      { type: 'text-delta', textDelta: 'x' },
      { type: 'error', error: new Error('上游炸了') },
    ];
    const provider = makeAiSdkProvider(() => ({}) as any);
    await expect(collect(provider.streamTurn({ system: 's', prompt: 'p', tools: {} }))).rejects.toThrow('上游炸了');
  });

  it('system/prompt 透传给 streamText;工具被包成带 ack execute 的 CoreTool', async () => {
    const { makeAiSdkProvider } = await import('../src/model/ai-sdk-runtime');
    const { z } = await import('zod');
    const provider = makeAiSdkProvider(() => ({}) as any);
    await collect(provider.streamTurn({ system: 'SYS', prompt: 'PR', tools: { foo: z.object({}) } }));
    expect(h.lastArgs.system).toBe('SYS');
    expect(h.lastArgs.prompt).toBe('PR');
    // toCoreTools 给每个工具加一个只回 {ok:true} 的 ack execute(开启多步,不在此应用剧本)。
    await expect(h.lastArgs.tools.foo.execute()).resolves.toEqual({ ok: true });
  });
});

describe('makeAiSdkProvider.completeLogline — 累加 textStream', () => {
  it('把 textStream 拼接并 trim', async () => {
    const { makeAiSdkProvider } = await import('../src/model/ai-sdk-runtime');
    h.textChunks = ['  一句', '话  '];
    const provider = makeAiSdkProvider(() => ({}) as any);
    const out = await provider.completeLogline({ system: 's', prompt: 'p' });
    expect(out).toBe('一句话');
  });

  it('temperature 透传给 streamText', async () => {
    const { makeAiSdkProvider } = await import('../src/model/ai-sdk-runtime');
    const provider = makeAiSdkProvider(() => ({}) as any);
    await provider.completeLogline({ system: 's', prompt: 'p', temperature: 1.1 });
    expect(h.lastArgs.temperature).toBe(1.1);
  });
});
