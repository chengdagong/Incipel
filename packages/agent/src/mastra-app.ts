import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { LocalSkillSource, Workspace } from '@mastra/core/workspace';
import { MastraEditor } from '@mastra/editor';
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
import {
  createMckeeCriticReviewTools,
  type MckeeCriticRegistry,
} from './mckee-critic-review-tool.ts';
import { createStudioScreenplayTools } from './studio-screenplay-tools.ts';

export type IncipelAgentName = 'screenwriter' | 'studio-screenwriter' | 'mckee-story-critic' | 'logline';

export const AGENT_PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const AGENT_SKILLS_PATH = 'skills';
export const SCREENWRITING_MASTER_SKILL_PATH = fileURLToPath(
  new URL('../skills/screenwriting-master', import.meta.url),
);

const STUDIO_MCKEE_CRITIC_SOURCE_PROMPT =
  'Mastra Studio 调试会话。studio-screenwriter 使用与生产 screenwriter 相同的静态 instructions,并通过本地 Studio screenplay tools 读写调试剧本;调用方应在 userGoal 与 draft 中提供本次需要评论的目标和草稿。';

export function createMastraAgents(config: ModelRuntimeConfig) {
  const screenwriterInstructions = buildScreenwriterInstructions();
  const mckeeStoryCritic = createAgent(
    'incipel-mckee-story-critic',
    'Incipel McKee Story Critic',
    config.turn,
    buildMckeeStoryCriticInstructions(),
  );
  const criticRegistry: MckeeCriticRegistry = {
    getAgent: () => mckeeStoryCritic,
  };

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
        tools: {
          ...createStudioScreenplayTools(),
          ...createMckeeCriticReviewTools({
            registry: criticRegistry,
            sourcePrompt: STUDIO_MCKEE_CRITIC_SOURCE_PROMPT,
            useConfig: config.turn,
            provider: config.provider,
          }),
        },
      },
    ),
    'mckee-story-critic': mckeeStoryCritic,
    logline: createAgent('incipel-logline', 'Incipel Logline', config.logline, LOGLINE_INSTRUCTIONS),
  };
}

export type IncipelMastraAgents = ReturnType<typeof createMastraAgents>;
export type IncipelMastraApp = Mastra<IncipelMastraAgents>;

export function createMastraApp(config: ModelRuntimeConfig = getModelConfig()): IncipelMastraApp {
  return new Mastra({
    agents: createMastraAgents(config),
    editor: new MastraEditor(),
    storage: new InMemoryStore({ id: 'incipel-mastra-runtime' }),
    workspace: createAgentWorkspace(),
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

function createAgentWorkspace() {
  return new Workspace({
    id: 'incipel-agent-workspace',
    name: 'Incipel Agent Workspace',
    skills: [AGENT_SKILLS_PATH],
    skillSource: new LocalSkillSource({ basePath: AGENT_PACKAGE_ROOT }),
    checkSkillFileMtime: true,
  });
}
