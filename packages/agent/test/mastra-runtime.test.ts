import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { StreamChunk } from '../src/model/provider';
import type { ModelRuntimeConfig } from '../src/model/config';

const h = vi.hoisted(() => ({
  streamChunks: [] as any[],
  generatedText: '一句测试 logline',
  lastAgentConfig: null as any,
  getAgentCalls: [] as string[],
  lastAgentName: null as string | null,
  lastStreamMessages: null as any,
  lastStreamOptions: null as any,
  createdTools: [] as any[],
}));

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: any) {
      h.lastAgentConfig = config;
    }

    async stream(messages: any, options: any) {
      h.lastStreamMessages = messages;
      h.lastStreamOptions = options;
      return {
        fullStream: (async function* () {
          for (const chunk of h.streamChunks) yield chunk;
        })(),
        text: Promise.resolve(h.generatedText),
      };
    }
  },
}));

vi.mock('../src/mastra-app.ts', () => ({
  getMastraApp: () => ({
    getAgent: (name: string) => {
      h.getAgentCalls.push(name);
      return {
        stream: async (messages: any, options: any) => {
          h.lastAgentName = name;
          h.lastStreamMessages = messages;
          h.lastStreamOptions = options;
          return {
            fullStream: (async function* () {
              for (const chunk of h.streamChunks) yield chunk;
            })(),
            text: Promise.resolve(h.generatedText),
          };
        },
      };
    },
  }),
}));

vi.mock('@mastra/core/tools', () => ({
  createTool: (definition: any) => {
    h.createdTools.push(definition);
    return definition;
  },
}));

beforeEach(() => {
  h.streamChunks = [];
  h.generatedText = '一句测试 logline';
  h.lastAgentConfig = null;
  h.getAgentCalls = [];
  h.lastAgentName = null;
  h.lastStreamMessages = null;
  h.lastStreamOptions = null;
  h.createdTools = [];
  process.env.OPENROUTER_API_KEY = 'sk-test';
});

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

function config(overrides: Partial<ModelRuntimeConfig> = {}): ModelRuntimeConfig {
  return {
    provider: 'openrouter',
    turn: {
      model: 'openai/gpt-test',
      temperature: 0.2,
      reasoning: { enabled: true, effort: 'high' },
    },
    logline: {
      model: 'openai/gpt-logline',
      temperature: 0.5,
      reasoning: { enabled: false },
    },
    ...overrides,
  };
}

describe('createMastraProvider.streamTurn', () => {
  it('把 Mastra fullStream 翻译成现有 StreamChunk,并透传 prompt、tools 与调用配置', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    h.streamChunks = [
      { type: 'text-delta', payload: { text: '你好' } },
      {
        type: 'tool-call-input-streaming-start',
        payload: { toolCallId: '1', toolName: 'add_character' },
      },
      {
        type: 'tool-call',
        payload: { toolCallId: '1', toolName: 'add_character', args: { name: '林深' } },
      },
      { type: 'step-finish', payload: {} },
    ];

    const provider = createMastraProvider(config());
    const chunks = await collect(
      provider.streamTurn({
        system: 'SYS',
        prompt: 'PR',
        tools: { add_character: z.object({ name: z.string() }) },
      }),
    );

    expect(chunks).toEqual([
      { type: 'text', delta: '你好' },
      { type: 'tool-call-start', toolCallId: '1', toolName: 'add_character' },
      { type: 'tool-call', call: { toolCallId: '1', toolName: 'add_character', args: { name: '林深' } } },
    ]);
    expect(h.lastAgentConfig).toBeNull();
    expect(h.getAgentCalls).toEqual(['screenwriter']);
    expect(h.lastAgentName).toBe('screenwriter');
    expect(h.lastStreamMessages).toBe('PR');
    expect(h.lastStreamOptions).toMatchObject({
      system: 'SYS',
      maxSteps: 8,
      toolChoice: 'auto',
      modelSettings: { temperature: 0.2 },
      providerOptions: { openrouter: { reasoning: { enabled: true, effort: 'high' } } },
    });
    expect(Object.keys(h.lastStreamOptions.clientTools)).toEqual(['add_character']);
    expect(h.lastStreamOptions.tools).toBeUndefined();
    expect(h.createdTools[0]).toMatchObject({
      id: 'add_character',
      description: 'Incipel internal screenplay tool: add_character',
    });
    await expect(h.createdTools[0].execute()).resolves.toEqual({ ok: true });
  });

  it('error chunk 会抛出,交给 runTurnCore 的重试与 RUN_ERROR 处理', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    h.streamChunks = [
      { type: 'text-delta', payload: { text: 'x' } },
      { type: 'error', payload: { error: new Error('model down') } },
    ];

    const provider = createMastraProvider(config());

    await expect(collect(provider.streamTurn({ system: 's', prompt: 'p', tools: {} }))).rejects.toThrow('model down');
    expect(h.getAgentCalls).toEqual(['screenwriter']);
  });
});

describe('createMastraProvider.completeLogline', () => {
  it('使用 logline 模型并 trim Mastra text 结果', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    h.generatedText = '  一句新的 logline  ';

    const provider = createMastraProvider(config());
    const out = await provider.completeLogline({ system: 'SYS', prompt: 'PR' });

    expect(out).toBe('一句新的 logline');
    expect(h.lastAgentConfig).toBeNull();
    expect(h.getAgentCalls).toEqual(['logline']);
    expect(h.lastAgentName).toBe('logline');
    expect(h.lastStreamMessages).toBe('PR');
    expect(h.lastStreamOptions).toMatchObject({
      system: 'SYS',
      maxSteps: 1,
      toolChoice: 'none',
      modelSettings: { temperature: 0.5 },
    });
  });
});
