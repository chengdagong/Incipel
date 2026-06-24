import { Agent } from '@mastra/core/agent';
import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
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

const MAX_TURN_STEPS = 8;

export function createMastraProvider(config: ModelRuntimeConfig = getModelConfig()): ModelProvider {
  if (config.provider !== 'openrouter') {
    throw new Error(`Mastra provider 不支持 MODEL_PROVIDER=${config.provider}`);
  }
  if (!env('OPENROUTER_API_KEY')) {
    throw new Error('OPENROUTER_API_KEY 未配置');
  }

  return {
    async *streamTurn(input: StreamTurnInput): AsyncIterable<StreamChunk> {
      const agent = createAgent('incipel-screenwriter', 'Incipel Screenwriter', config.turn);
      const stream = await agent.stream(input.prompt, {
        system: input.system,
        maxSteps: MAX_TURN_STEPS,
        clientTools: toMastraTools(input.tools),
        toolChoice: 'auto',
        modelSettings: modelSettings(config.turn),
        providerOptions: providerOptionsForUse(config.provider, config.turn),
      });

      for await (const chunk of stream.fullStream as AsyncIterable<MastraChunk>) {
        const translated = translateChunk(chunk);
        if (translated === null) continue;
        yield translated;
      }
    },

    async completeLogline(input: CompleteLoglineInput): Promise<string> {
      const agent = createAgent('incipel-logline', 'Incipel Logline', config.logline);
      const stream = await agent.stream(input.prompt, {
        system: input.system,
        maxSteps: 1,
        toolChoice: 'none',
        modelSettings: modelSettings(config.logline),
        providerOptions: providerOptionsForUse(config.provider, config.logline),
      });
      return (await stream.text).trim();
    },
  };
}

function createAgent(id: string, name: string, useConfig: ModelUseConfig): Agent {
  return new Agent({
    id,
    name,
    instructions: '',
    model: mastraModelId(useConfig.model),
  });
}

function mastraModelId(model: string): string {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}

function modelSettings(useConfig: ModelUseConfig): Record<string, unknown> | undefined {
  if (useConfig.temperature === undefined) return undefined;
  return { temperature: useConfig.temperature };
}

function toMastraTools(schemas: Record<string, z.ZodTypeAny>): ToolsInput {
  const tools: ToolsInput = {};
  for (const [name, schema] of Object.entries(schemas)) {
    tools[name] = createTool({
      id: name,
      description: `Incipel internal screenplay tool: ${name}`,
      inputSchema: schema,
      execute: async () => ({ ok: true }),
    });
  }
  return tools;
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

function translateChunk(chunk: MastraChunk): StreamChunk | null {
  switch (chunk.type) {
    case 'text-delta': {
      const text = chunk.payload?.text;
      return typeof text === 'string' && text ? { type: 'text', delta: text } : null;
    }
    case 'tool-call-input-streaming-start': {
      const toolCallId = chunk.payload?.toolCallId;
      const toolName = chunk.payload?.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return null;
      return { type: 'tool-call-start', toolCallId, toolName };
    }
    case 'tool-call': {
      const toolCallId = chunk.payload?.toolCallId;
      const toolName = chunk.payload?.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return null;
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
