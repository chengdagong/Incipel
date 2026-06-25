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

describe('createScreenplayMastraTools', () => {
  it('把 Mastra execute 的第一个参数传给 screenplay tool 执行器', async () => {
    const { createScreenplayMastraTools } = await import('../src/screenplay-mastra-tools');
    const executeTool = vi.fn(async () => ({ ok: true }));

    const tools = createScreenplayMastraTools({
      schemas: { add_character: z.object({ name: z.string() }) },
      executeTool,
    });

    const addCharacter = tools.add_character as {
      execute: (args?: unknown, context?: unknown) => Promise<unknown>;
    };
    await addCharacter.execute({ name: '林岑' }, {});

    expect(executeTool).toHaveBeenCalledWith({
      toolName: 'add_character',
      args: { name: '林岑' },
    });
  });
});

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
      maxSteps: 8,
      toolChoice: 'auto',
      modelSettings: { temperature: 0.2 },
      providerOptions: { openrouter: { reasoning: { enabled: true, effort: 'high' } } },
    });
    expect(h.lastStreamOptions).not.toHaveProperty('system');
    expect(Object.keys(h.lastStreamOptions.toolsets.screenplay)).toEqual(['add_character']);
    expect(Object.keys(h.lastStreamOptions.toolsets.review)).toEqual(['request_mckee_story_critique']);
    expect(h.lastStreamOptions.clientTools).toBeUndefined();
    expect(h.createdTools[0]).toMatchObject({
      id: 'add_character',
      description: 'Incipel screenplay tool: add_character',
    });
    await expect(h.createdTools[0].execute()).resolves.toEqual({ ok: true });
    const reviewTool = h.createdTools.find((tool) => tool.id === 'request_mckee_story_critique')!;
    expect(reviewTool).toMatchObject({
      id: 'request_mckee_story_critique',
      description: 'Ask the McKee story critic Agent to review an outline or beat draft.',
    });
    await expect(
      reviewTool.execute({
        userGoal: '完善第二幕',
        draft: '第二幕里主角找到线索,然后去见反派。',
        target: 'beats',
      }),
    ).resolves.toEqual({ review: '一句测试 logline' });
    expect(h.getAgentCalls).toEqual(['screenwriter', 'mckee-story-critic']);
  });

  it('error chunk 会抛出,交给 runTurnCore 的重试与 RUN_ERROR 处理', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    h.streamChunks = [
      { type: 'text-delta', payload: { text: 'x' } },
      { type: 'error', payload: { error: new Error('model down') } },
    ];

    const provider = createMastraProvider(config());

    await expect(collect(provider.streamTurn({ prompt: 'p', tools: {} }))).rejects.toThrow('model down');
    expect(h.getAgentCalls).toEqual(['screenwriter']);
  });

  it('只把本轮剧本工具调用转成 StreamChunk,忽略 Mastra skill 内部工具调用', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    h.streamChunks = [
      {
        type: 'tool-call-input-streaming-start',
        payload: { toolCallId: 'skill-1', toolName: 'load_skill' },
      },
      {
        type: 'tool-call',
        payload: { toolCallId: 'skill-1', toolName: 'load_skill', args: { skillName: 'screenwriting-master' } },
      },
      {
        type: 'tool-call-input-streaming-start',
        payload: { toolCallId: 'story-1', toolName: 'add_character' },
      },
      {
        type: 'tool-call',
        payload: { toolCallId: 'story-1', toolName: 'add_character', args: { name: '林深' } },
      },
    ];

    const provider = createMastraProvider(config());
    const chunks = await collect(
      provider.streamTurn({
        prompt: 'p',
        tools: { add_character: z.object({ name: z.string() }) },
      }),
    );

    expect(chunks).toEqual([
      { type: 'tool-call-start', toolCallId: 'story-1', toolName: 'add_character' },
      {
        type: 'tool-call',
        call: { toolCallId: 'story-1', toolName: 'add_character', args: { name: '林深' } },
      },
    ]);
  });
});

describe('createMastraProvider.completeLogline', () => {
  it('使用 logline 模型并 trim Mastra text 结果', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    h.generatedText = '  一句新的 logline  ';

    const provider = createMastraProvider(config());
    const out = await provider.completeLogline({ prompt: 'PR' });

    expect(out).toBe('一句新的 logline');
    expect(h.lastAgentConfig).toBeNull();
    expect(h.getAgentCalls).toEqual(['logline']);
    expect(h.lastAgentName).toBe('logline');
    expect(h.lastStreamMessages).toBe('PR');
    expect(h.lastStreamOptions).toMatchObject({
      maxSteps: 1,
      toolChoice: 'none',
      modelSettings: { temperature: 0.5 },
    });
    expect(h.lastStreamOptions).not.toHaveProperty('system');
  });
});
