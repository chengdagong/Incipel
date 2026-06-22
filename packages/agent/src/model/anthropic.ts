// Anthropic provider:用 Vercel AI SDK(ai)+ @ai-sdk/anthropic 取模型,流式编排走
// ai-sdk-runtime 的通用实现。Claude 的 tool use 可靠,符合 ADR-0001「只接 tool-use 可靠的
// provider」。
//
// TURN_MODEL / LOGLINE_MODEL 由 env 覆盖;默认接强模型(每轮)与便宜小模型(logline)。

import { createAnthropic } from '@ai-sdk/anthropic';
import { makeAiSdkProvider } from './ai-sdk-runtime.ts';
import type { ModelProvider } from './provider.ts';
import { env } from '../env.ts';

const DEFAULT_TURN_MODEL = 'claude-sonnet-4-5';
const DEFAULT_LOGLINE_MODEL = 'claude-3-5-haiku-latest';

export function createAnthropicProvider(): ModelProvider {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY 未配置');
  }
  const anthropic = createAnthropic({ apiKey });

  return makeAiSdkProvider((kind) => {
    const id =
      kind === 'turn'
        ? (env('TURN_MODEL') ?? DEFAULT_TURN_MODEL)
        : (env('LOGLINE_MODEL') ?? DEFAULT_LOGLINE_MODEL);
    return anthropic(id);
  });
}
