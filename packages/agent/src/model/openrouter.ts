// OpenRouter provider:用 @openrouter/ai-sdk-provider 取模型,流式编排走 ai-sdk-runtime 的
// 通用实现。OpenRouter 可路由到多家强模型;v1 只在 tool-use 可靠的强模型上使用(ADR-0001)。
//
// 模型 id 由 env OPENROUTER_MODEL 指定;默认给一个 tool-use 可靠的强模型。
// logline 默认沿用同一模型(OpenRouter 端点用得少,可另设 LOGLINE_MODEL 覆盖)。

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { makeAiSdkProvider } from './ai-sdk-runtime';
import type { ModelProvider } from './provider';

// tool-use 可靠的强模型。可经 env OPENROUTER_MODEL 覆盖。
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5';

export function createOpenRouterProvider(): ModelProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY 未配置');
  }
  // strict:走官方 OpenRouter API 时按其完整能力发送(含 streamOptions)。
  const openrouter = createOpenRouter({ apiKey, compatibility: 'strict' });
  const turnModel = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;

  return makeAiSdkProvider((kind) => {
    const id = kind === 'turn' ? turnModel : (process.env.LOGLINE_MODEL ?? turnModel);
    return openrouter(id);
  });
}
