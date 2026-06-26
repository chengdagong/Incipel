import {
  getModelConfig,
  providerOptionsForUse,
  type ModelRuntimeConfig,
  type ModelUseConfig,
} from './config.ts';
import type {
  CompleteLoglineInput,
  ModelProvider,
  StreamChunk,
  StreamTurnInput,
} from './provider.ts';
import { env } from '../env.ts';
import { getMastraApp, type IncipelAgentName } from '../mastra/index.ts';
import { createMckeeCriticReviewTools } from '../mastra/tools/mckee-critic-review.ts';
import { createNoopScreenplayMastraTools } from '../mastra/tools/screenplay.ts';

const MAX_TURN_STEPS = 8;

type MastraAgentLike = {
  stream(
    prompt: string,
    options: Record<string, unknown>,
  ): Promise<{
    fullStream: AsyncIterable<MastraChunk>;
    text: Promise<string>;
  }>;
};

type MastraAgentRegistry = {
  getAgent(name: IncipelAgentName): MastraAgentLike;
};

export function createMastraProvider(
  config: ModelRuntimeConfig = getModelConfig(),
  mastra?: MastraAgentRegistry,
): ModelProvider {
  if (config.provider !== 'openrouter') {
    throw new Error(`Mastra provider 不支持 MODEL_PROVIDER=${config.provider}`);
  }
  if (!env('OPENROUTER_API_KEY')) {
    throw new Error('OPENROUTER_API_KEY 未配置');
  }
  const registry = mastra ?? (getMastraApp(config) as MastraAgentRegistry);

  return {
    async *streamTurn(input: StreamTurnInput): AsyncIterable<StreamChunk> {
      const agent = registry.getAgent('screenwriter');
      const screenplayToolNames = new Set(Object.keys(input.tools));
      const stream = await agent.stream(input.prompt, {
        maxSteps: MAX_TURN_STEPS,
        toolsets: {
          screenplay: createNoopScreenplayMastraTools(input.tools),
          review: createMckeeCriticReviewTools({
            registry,
            sourcePrompt: input.prompt,
            useConfig: config.turn,
            provider: config.provider,
          }),
        },
        toolChoice: 'auto',
        modelSettings: modelSettings(config.turn),
        providerOptions: providerOptionsForUse(config.provider, config.turn),
      });

      for await (const chunk of stream.fullStream as AsyncIterable<MastraChunk>) {
        const translated = translateChunk(chunk, screenplayToolNames);
        if (translated === null) continue;
        yield translated;
      }
    },

    async completeLogline(input: CompleteLoglineInput): Promise<string> {
      const agent = registry.getAgent('logline');
      const stream = await agent.stream(input.prompt, {
        maxSteps: 1,
        toolChoice: 'none',
        modelSettings: modelSettings(config.logline),
        providerOptions: providerOptionsForUse(config.provider, config.logline),
      });
      return (await stream.text).trim();
    },
  };
}

function modelSettings(useConfig: ModelUseConfig): Record<string, unknown> | undefined {
  if (useConfig.temperature === undefined) return undefined;
  return { temperature: useConfig.temperature };
}

type MastraChunk = {
  type: string;
  payload?: {
    text?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    args?: unknown;
    error?: unknown;
  };
};

function translateChunk(chunk: MastraChunk, allowedToolNames?: Set<string>): StreamChunk | null {
  switch (chunk.type) {
    case 'text-delta': {
      const text = chunk.payload?.text;
      return typeof text === 'string' && text ? { type: 'text', delta: text } : null;
    }
    case 'tool-call-input-streaming-start': {
      const toolCallId = chunk.payload?.toolCallId;
      const toolName = chunk.payload?.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return null;
      if (allowedToolNames && !allowedToolNames.has(toolName)) return null;
      return { type: 'tool-call-start', toolCallId, toolName };
    }
    case 'tool-call': {
      const toolCallId = chunk.payload?.toolCallId;
      const toolName = chunk.payload?.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return null;
      if (allowedToolNames && !allowedToolNames.has(toolName)) return null;
      return {
        type: 'tool-call',
        call: {
          toolCallId,
          toolName,
          args: chunk.payload?.args,
        },
      };
    }
    case 'error': {
      const error = chunk.payload?.error;
      throw error instanceof Error ? error : new Error(String(error ?? 'Mastra stream error'));
    }
    default:
      return null;
  }
}
