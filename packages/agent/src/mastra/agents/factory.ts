import { Agent, type AgentConfig, type ToolsInput } from '@mastra/core/agent';
import {
  type ModelUseConfig,
  type ProviderName,
} from '../../model/config.ts';
import { incipelAgentScorers } from '../scorers.ts';
import { createOpenRouterModel } from '../tools/openrouter-tools.ts';

type CreateAgentOptions = Pick<
  AgentConfig<string, ToolsInput>,
  'editor' | 'inputProcessors' | 'memory' | 'scorers' | 'skills' | 'tools'
>;

export function createAgent(
  id: string,
  name: string,
  provider: ProviderName,
  useConfig: ModelUseConfig,
  instructions: string,
  options: CreateAgentOptions = {},
): Agent {
  const {
    editor,
    inputProcessors,
    skills,
    tools,
    memory,
    scorers = incipelAgentScorers,
  } = options;
  const defaultOptions = defaultOptionsForUse(useConfig);
  return new Agent({
    id,
    name,
    instructions,
    model: mastraModel(provider, useConfig),
    ...(defaultOptions ? { defaultOptions } : {}),
    ...(editor !== undefined ? { editor } : {}),
    ...(inputProcessors ? { inputProcessors } : {}),
    ...(skills ? { skills } : {}),
    ...(tools ? { tools } : {}),
    ...(memory ? { memory } : {}),
    ...(scorers ? { scorers } : {}),
  });
}

function mastraModelId(model: string): string {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}

function mastraModel(
  provider: ProviderName,
  useConfig: ModelUseConfig,
): AgentConfig<string, ToolsInput>['model'] {
  if (provider === 'openrouter') return createOpenRouterModel(useConfig.model, useConfig);
  return mastraModelId(useConfig.model);
}

function defaultOptionsForUse(
  useConfig: ModelUseConfig,
): AgentConfig<string, ToolsInput>['defaultOptions'] | undefined {
  const modelSettings = useConfig.temperature === undefined ? undefined : { temperature: useConfig.temperature };

  if (!modelSettings) return undefined;
  return {
    modelSettings,
  } as AgentConfig<string, ToolsInput>['defaultOptions'];
}
