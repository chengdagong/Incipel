import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { fileURLToPath } from 'node:url';
import {
  getModelConfig,
  type ModelRuntimeConfig,
  type ModelUseConfig,
} from './model/config.ts';
import {
  buildMckeeStoryCriticInstructions,
  buildScreenwriterInstructions,
  LOGLINE_INSTRUCTIONS,
} from './prompt.ts';
import { createStudioScreenplayTools } from './studio-screenplay-tools.ts';

export type IncipelAgentName = 'screenwriter' | 'studio-screenwriter' | 'mckee-story-critic' | 'logline';

export const SCREENWRITING_MASTER_SKILL_PATH = fileURLToPath(
  new URL('../skills/screenwriting-master', import.meta.url),
);

export function createMastraAgents(config: ModelRuntimeConfig) {
  const screenwriterInstructions = buildScreenwriterInstructions();

  return {
    screenwriter: createAgent(
      'incipel-screenwriter',
      'Incipel Screenwriter',
      config.turn,
      screenwriterInstructions,
      { skills: [SCREENWRITING_MASTER_SKILL_PATH] },
    ),
    'studio-screenwriter': createAgent(
      'incipel-studio-screenwriter',
      'Incipel Studio Screenwriter',
      config.turn,
      screenwriterInstructions,
      {
        skills: [SCREENWRITING_MASTER_SKILL_PATH],
        tools: createStudioScreenplayTools(),
      },
    ),
    'mckee-story-critic': createAgent(
      'incipel-mckee-story-critic',
      'Incipel McKee Story Critic',
      config.turn,
      buildMckeeStoryCriticInstructions(),
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
  options: { skills?: string[]; tools?: ToolsInput } = {},
): Agent {
  const { skills, tools } = options;
  return new Agent({
    id,
    name,
    instructions,
    model: mastraModelId(useConfig.model),
    ...(skills ? { skills } : {}),
    ...(tools ? { tools } : {}),
  });
}

function mastraModelId(model: string): string {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}
