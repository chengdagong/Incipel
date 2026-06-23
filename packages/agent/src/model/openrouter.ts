// OpenRouter provider:用 @openrouter/ai-sdk-provider 取模型,流式编排走 ai-sdk-runtime 的
// 通用实现。OpenRouter 可路由到多家强模型;v1 只在 tool-use 可靠的强模型上使用(ADR-0001)。
//
// 模型 id / temperature / reasoning 参数来自 packages/agent/model.config.json。

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getModelConfig, providerOptionsForUse, type ModelRuntimeConfig } from './config.ts';
import { makeAiSdkProvider } from './ai-sdk-runtime.ts';
import type { ModelProvider } from './provider.ts';
import { env } from '../env.ts';

export function createOpenRouterProvider(config: ModelRuntimeConfig = getModelConfig('openrouter')): ModelProvider {
  const apiKey = env('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY 未配置');
  }
  // strict:走官方 OpenRouter API 时按其完整能力发送(含 streamOptions)。
  const openrouter = createOpenRouter({ apiKey, compatibility: 'strict' });

  return makeAiSdkProvider((kind) => {
    const useConfig = config[kind];
    return {
      model: openrouter(useConfig.model),
      temperature: useConfig.temperature,
      providerOptions: providerOptionsForUse('openrouter', useConfig),
    };
  });
}
