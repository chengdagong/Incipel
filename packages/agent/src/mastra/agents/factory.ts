import { Agent, type AgentConfig, type ToolsInput } from '@mastra/core/agent';
import {
  providerOptionsForUse,
  type ModelUseConfig,
  type ProviderName,
} from '../../model/config.ts';
import { incipelAgentScorers } from '../scorers.ts';

type CreateAgentOptions = Pick<AgentConfig<string, ToolsInput>, 'editor' | 'memory' | 'scorers' | 'skills' | 'tools'>;

export function createAgent(
  id: string,
  name: string,
  provider: ProviderName,
  useConfig: ModelUseConfig,
  instructions: string,
  options: CreateAgentOptions = {},
): Agent {
  const { editor, skills, tools, memory, scorers = incipelAgentScorers } = options;
  const defaultOptions = defaultOptionsForUse(provider, useConfig);
  return new Agent({
    id,
    name,
    instructions,
    model: mastraModelId(useConfig.model),
    ...(defaultOptions ? { defaultOptions } : {}),
    ...(editor !== undefined ? { editor } : {}),
    ...(skills ? { skills } : {}),
    ...(tools ? { tools } : {}),
    ...(memory ? { memory } : {}),
    ...(scorers ? { scorers } : {}),
  });
}

function mastraModelId(model: string): string {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}

function defaultOptionsForUse(
  provider: ProviderName,
  useConfig: ModelUseConfig,
): AgentConfig<string, ToolsInput>['defaultOptions'] | undefined {
  const modelSettings = useConfig.temperature === undefined ? undefined : { temperature: useConfig.temperature };
  const providerOptions = providerOptionsForUse(provider, useConfig);

  if (!modelSettings && !providerOptions) return undefined;
  return {
    ...(modelSettings ? { modelSettings } : {}),
    ...(providerOptions ? { providerOptions: providerOptions as Record<string, Record<string, unknown>> } : {}),
  } as AgentConfig<string, ToolsInput>['defaultOptions'];
}
