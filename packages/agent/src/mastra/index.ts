import { Mastra } from '@mastra/core/mastra';
import {
  MastraCompositeStore,
  type StorageCreateAgentInput,
  type StorageModelConfig,
  type StorageToolConfig,
} from '@mastra/core/storage';
import { LocalSkillSource, Workspace } from '@mastra/core/workspace';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraEditor } from '@mastra/editor';
import { LibSQLStore } from '@mastra/libsql';
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
  SensitiveDataFilter,
} from '@mastra/observability';
import {
  getModelConfig,
  type ModelRuntimeConfig,
} from '../model/config.ts';
import { incipelMastraScorers } from './scorers.ts';
import {
  AGENT_PACKAGE_ROOT,
  AGENT_SKILLS_PATH,
  MASTRA_STUDIO_DB_PATH,
  MASTRA_STUDIO_OBSERVABILITY_DB_PATH,
  createMastraAgents,
  type IncipelAgentName,
} from './agents/index.ts';

export {
  AGENT_PACKAGE_ROOT,
  AGENT_SKILLS_PATH,
  createMastraAgents,
  MASTRA_STUDIO_DB_PATH,
  MASTRA_STUDIO_OBSERVABILITY_DB_PATH,
  SCREENWRITING_MASTER_SKILL_PATH,
} from './agents/index.ts';
export type { IncipelAgentName } from './agents/index.ts';

export type IncipelMastraAgents = ReturnType<typeof createMastraAgents>;
export type IncipelMastraApp = Mastra<IncipelMastraAgents>;
type EditorAgentsStore = {
  getById(id: string): Promise<{
    id: string;
    status: string;
    activeVersionId?: string | null;
    metadata?: Record<string, unknown>;
  } | null>;
  getByIdResolved(id: string, options?: { status?: 'draft' | 'published' }): Promise<{
    id: string;
    instructions: unknown;
    tools?: unknown;
  } | null>;
};
type StoredAgentTools = Record<string, StorageToolConfig>;

export function createMastraApp(config: ModelRuntimeConfig = getModelConfig()): IncipelMastraApp {
  return new Mastra({
    agents: createMastraAgents(config),
    editor: new MastraEditor(),
    observability: createMastraStudioObservability(),
    scorers: incipelMastraScorers,
    storage: createMastraStudioStorage(),
    workspace: createAgentWorkspace(),
  });
}

let mastraApp: IncipelMastraApp | null = null;

export function getMastraApp(config?: ModelRuntimeConfig): IncipelMastraApp {
  mastraApp ??= createMastraApp(config ?? getModelConfig());
  return mastraApp;
}

export async function prepareMastraStudioEditor(mastra: IncipelMastraApp = getMastraApp()): Promise<void> {
  const editor = mastra.getEditor();
  const storage = mastra.getStorage();
  if (!editor || !storage) return;

  const agentsStore = await storage.getStore('agents');
  if (!agentsStore) return;
  const editorAgentsStore = agentsStore as EditorAgentsStore;

  const agents = mastra.listAgents();
  for (const [registrationName, agent] of Object.entries(agents)) {
    if (agent.source !== 'code') continue;

    const seed = await createEditorAgentSeed(agent, registrationName);
    const existing = await editorAgentsStore.getById(agent.id);
    if (existing) {
      if (await shouldRefreshCodeOwnedTools(editorAgentsStore, seed)) {
        editor.agent.clearCache(agent.id);
        await editor.agent.update({ id: agent.id, tools: seed.tools });
      }
      continue;
    }

    await editor.agent.create(seed);
  }
}

async function shouldRefreshCodeOwnedTools(
  agentsStore: EditorAgentsStore,
  seed: StorageCreateAgentInput,
): Promise<boolean> {
  if (!seed.tools) return false;
  const existing = await agentsStore.getById(seed.id);
  if (!existing) return false;
  if (existing.metadata?.source !== 'code') return false;
  if (existing.metadata?.registrationName !== seed.metadata?.registrationName) return false;

  const draft = await agentsStore.getByIdResolved(seed.id, { status: 'draft' });
  if (!draft) return false;

  return !storedToolsEqual(draft.tools, seed.tools);
}

async function createEditorAgentSeed(
  agent: IncipelMastraAgents[IncipelAgentName],
  registrationName: string,
): Promise<StorageCreateAgentInput> {
  const llm = await agent.getLLM();
  const defaultOptions = await agent.getDefaultOptions();
  const modelSettings = defaultOptions?.modelSettings;

  const model: StorageModelConfig = {
    provider: llm.getProvider(),
    name: llm.getModelId(),
    ...(modelSettings?.temperature !== undefined ? { temperature: modelSettings.temperature } : {}),
    ...(modelSettings?.topP !== undefined ? { topP: modelSettings.topP } : {}),
    ...(modelSettings?.frequencyPenalty !== undefined
      ? { frequencyPenalty: modelSettings.frequencyPenalty }
      : {}),
    ...(modelSettings?.presencePenalty !== undefined ? { presencePenalty: modelSettings.presencePenalty } : {}),
    ...(modelSettings?.maxOutputTokens !== undefined
      ? { maxCompletionTokens: modelSettings.maxOutputTokens }
      : {}),
  };

  return {
    id: agent.id,
    name: agent.name,
    description: agent.getDescription() || undefined,
    instructions: normalizeInstructions(await agent.getInstructions()),
    model,
    tools: await createStoredToolConfig(agent),
    metadata: {
      source: 'code',
      registrationName,
    },
  };
}

async function createStoredToolConfig(
  agent: IncipelMastraAgents[IncipelAgentName],
): Promise<StoredAgentTools | undefined> {
  const tools = await agent.listTools();
  const toolNames = Object.keys(tools ?? {}).sort();
  if (toolNames.length === 0) return undefined;
  return Object.fromEntries(toolNames.map((toolName) => [toolName, {}]));
}

function storedToolsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeStoredTools(left)) === JSON.stringify(normalizeStoredTools(right));
}

function normalizeStoredTools(value: unknown): StoredAgentTools | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, StorageToolConfig>)
    .filter(([, config]) => config && typeof config === 'object' && !Array.isArray(config))
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function normalizeInstructions(instructions: unknown): string {
  if (typeof instructions === 'string') return instructions;
  if (Array.isArray(instructions)) {
    return instructions
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'content' in entry) {
          return typeof entry.content === 'string' ? entry.content : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  if (instructions && typeof instructions === 'object' && 'content' in instructions) {
    return typeof instructions.content === 'string' ? instructions.content : '';
  }
  return '';
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
  const studioStorage = new LibSQLStore({
    id: 'incipel-mastra-studio',
    url: `file:${MASTRA_STUDIO_DB_PATH}`,
  });
  const observabilityStorage = new DuckDBStore({
    path: MASTRA_STUDIO_OBSERVABILITY_DB_PATH,
  });

  const storage = new MastraCompositeStore({
    id: 'incipel-mastra-studio',
    default: studioStorage,
    domains: {
      observability: observabilityStorage.observability,
    },
  });
  storage.close = async () => {
    const results = await Promise.allSettled([
      studioStorage.close(),
      observabilityStorage.close(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  };
  return storage;
}

function createMastraStudioObservability() {
  return new Observability({
    configs: {
      local: {
        serviceName: 'incipel-agent-studio',
        sampling: { type: SamplingStrategyType.ALWAYS },
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  });
}
