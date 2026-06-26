import { Agent, type ToolsInput } from '@mastra/core/agent';
import type { Memory } from '@mastra/memory';
import type { ModelUseConfig } from '../../model/config.ts';

export function createAgent(
  id: string,
  name: string,
  useConfig: ModelUseConfig,
  instructions: string,
  options: { skills?: string[]; tools?: ToolsInput; memory?: Memory } = {},
): Agent {
  const { skills, tools, memory } = options;
  return new Agent({
    id,
    name,
    instructions,
    model: mastraModelId(useConfig.model),
    ...(skills ? { skills } : {}),
    ...(tools ? { tools } : {}),
    ...(memory ? { memory } : {}),
  });
}

function mastraModelId(model: string): string {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}
