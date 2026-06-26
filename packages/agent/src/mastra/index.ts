import { Mastra } from '@mastra/core/mastra';
import { LocalSkillSource, Workspace } from '@mastra/core/workspace';
import { MastraEditor } from '@mastra/editor';
import { LibSQLStore } from '@mastra/libsql';
import {
  getModelConfig,
  type ModelRuntimeConfig,
} from '../model/config.ts';
import {
  AGENT_PACKAGE_ROOT,
  AGENT_SKILLS_PATH,
  MASTRA_STUDIO_DB_PATH,
  createMastraAgents,
} from './agents/index.ts';

export {
  AGENT_PACKAGE_ROOT,
  AGENT_SKILLS_PATH,
  createMastraAgents,
  MASTRA_STUDIO_DB_PATH,
  SCREENWRITING_MASTER_SKILL_PATH,
} from './agents/index.ts';
export type { IncipelAgentName } from './agents/index.ts';

export type IncipelMastraAgents = ReturnType<typeof createMastraAgents>;
export type IncipelMastraApp = Mastra<IncipelMastraAgents>;

export function createMastraApp(config: ModelRuntimeConfig = getModelConfig()): IncipelMastraApp {
  return new Mastra({
    agents: createMastraAgents(config),
    editor: new MastraEditor(),
    storage: createMastraStudioStorage(),
    workspace: createAgentWorkspace(),
  });
}

let mastraApp: IncipelMastraApp | null = null;

export function getMastraApp(config?: ModelRuntimeConfig): IncipelMastraApp {
  mastraApp ??= createMastraApp(config ?? getModelConfig());
  return mastraApp;
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

function createMastraStudioStorage() {
  return new LibSQLStore({
    id: 'incipel-mastra-studio',
    url: `file:${MASTRA_STUDIO_DB_PATH}`,
  });
}
