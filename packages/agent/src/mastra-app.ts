import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { fileURLToPath } from 'node:url';
import {
  getModelConfig,
  type ModelRuntimeConfig,
  type ModelUseConfig,
} from './model/config.ts';
import { buildScreenwriterInstructions, LOGLINE_INSTRUCTIONS } from './prompt.ts';

export type IncipelAgentName = 'screenwriter' | 'logline';

export const SCREENWRITING_MASTER_SKILL_PATH = fileURLToPath(
  new URL('../skills/screenwriting-master', import.meta.url),
);

export function createMastraAgents(config: ModelRuntimeConfig) {
  return {
    screenwriter: createAgent(
      'incipel-screenwriter',
      'Incipel Screenwriter',
      config.turn,
      buildScreenwriterInstructions(),
      [SCREENWRITING_MASTER_SKILL_PATH],
    ),
    logline: createAgent('incipel-logline', 'Incipel Logline', config.logline, LOGLINE_INSTRUCTIONS),
  };
}

export type IncipelMastraAgents = ReturnType<typeof createMastraAgents>;
export type IncipelMastraApp = Mastra<IncipelMastraAgents>;

export function createMastraApp(config: ModelRuntimeConfig = getModelConfig()): IncipelMastraApp {
  return new Mastra({
    agents: createMastraAgents(config),
    storage: new InMemoryStore({ id: 'incipel-mastra-runtime' }),
  });
}

let mastraApp: IncipelMastraApp | null = null;

export function getMastraApp(config?: ModelRuntimeConfig): IncipelMastraApp {
  mastraApp ??= createMastraApp(config ?? getModelConfig());
  return mastraApp;
}

function createAgent(
  id: string,
  name: string,
  useConfig: ModelUseConfig,
  instructions: string,
  skills?: string[],
): Agent {
  return new Agent({
    id,
    name,
    instructions,
    skills,
    model: mastraModelId(useConfig.model),
  });
}

function mastraModelId(model: string): string {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}
