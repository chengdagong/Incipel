import { Agent, type AgentConfig, type ToolsInput } from '@mastra/core/agent';
import type { ModelUseConfig } from '../../model/config.ts';
import { incipelAgentScorers } from '../scorers.ts';

type CreateAgentOptions = Pick<AgentConfig<string, ToolsInput>, 'editor' | 'memory' | 'scorers' | 'skills' | 'tools'>;

export function createAgent(
  id: string,
  name: string,
  useConfig: ModelUseConfig,
  instructions: string,
  options: CreateAgentOptions = {},
): Agent {
  const { editor, skills, tools, memory, scorers = incipelAgentScorers } = options;
  return new Agent({
    id,
    name,
    instructions,
    model: mastraModelId(useConfig.model),
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
