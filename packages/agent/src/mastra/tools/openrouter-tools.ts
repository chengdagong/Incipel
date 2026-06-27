import type { ToolsInput } from '@mastra/core/agent';
import { createOpenRouter, type OpenRouterChatSettings } from '@openrouter/ai-sdk-provider';
import { env } from '../../env.ts';
import { providerOptionsForUse, type ModelUseConfig } from '../../model/config.ts';

const openrouter = createOpenRouter({
  apiKey: env('OPENROUTER_API_KEY'),
});

export const OPENROUTER_WEB_SEARCH_TOOL_NAME = 'openrouter_web_search';
export const OPENROUTER_WEB_FETCH_TOOL_NAME = 'openrouter_web_fetch';

export function createOpenRouterModel(model: string, useConfig: ModelUseConfig) {
  return openrouter(model, openRouterChatSettings(useConfig));
}

export function createOpenRouterServerTools(): ToolsInput {
  return {
    [OPENROUTER_WEB_SEARCH_TOOL_NAME]: openrouter.tools.webSearch({}) as ToolsInput[string],
    [OPENROUTER_WEB_FETCH_TOOL_NAME]: {
      type: 'provider',
      id: 'openrouter.web_fetch',
      args: {},
    } as ToolsInput[string],
  };
}

function openRouterChatSettings(useConfig: ModelUseConfig): OpenRouterChatSettings | undefined {
  const extraBody = providerOptionsForUse('openrouter', useConfig)?.openrouter;
  return extraBody ? { extraBody } : undefined;
}
