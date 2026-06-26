import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelRuntimeConfig } from '../src/model/config';

const h = vi.hoisted(() => ({
  agentConfigs: [] as any[],
  mastraConfigs: [] as any[],
  editorConfigs: [] as any[],
  libsqlStoreConfigs: [] as any[],
  memoryConfigs: [] as any[],
  observabilityConfigs: [] as any[],
  scorerConfigs: [] as any[],
  skillSourceConfigs: [] as any[],
  storageExporterConfigs: [] as any[],
  sensitiveDataFilterConfigs: [] as any[],
  workspaceConfigs: [] as any[],
}));

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.agentConfigs.push(config);
    }
  },
}));

vi.mock('@mastra/core/mastra', () => ({
  Mastra: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.mastraConfigs.push(config);
    }
  },
}));

vi.mock('@mastra/core/evals', () => ({
  createScorer: (config: any) => {
    const scorer = {
      config,
      generateScore(fn: any) {
        return { ...this, generateScoreFn: fn };
      },
    };
    h.scorerConfigs.push(config);
    return scorer;
  },
}));

vi.mock('@mastra/editor', () => ({
  MastraEditor: class {
    config: any;

    constructor(config?: any) {
      this.config = config;
      h.editorConfigs.push(config ?? {});
    }
  },
}));

vi.mock('@mastra/observability', () => ({
  MastraStorageExporter: class {
    config: any;

    constructor(config?: any) {
      this.config = config ?? {};
      h.storageExporterConfigs.push(config ?? {});
    }
  },
  Observability: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.observabilityConfigs.push(config);
    }
  },
  SensitiveDataFilter: class {
    config: any;

    constructor(config?: any) {
      this.config = config ?? {};
      h.sensitiveDataFilterConfigs.push(config ?? {});
    }
  },
  SamplingStrategyType: {
    ALWAYS: 'always',
  },
}));

vi.mock('@mastra/libsql', () => ({
  LibSQLStore: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.libsqlStoreConfigs.push(config);
    }
  },
}));

vi.mock('@mastra/memory', () => ({
  Memory: class {
    config: any;

    constructor(config?: any) {
      this.config = config ?? {};
      h.memoryConfigs.push(config ?? {});
    }
  },
}));

vi.mock('@mastra/core/storage', () => ({
  InMemoryStore: class {
    config: any;

    constructor(config: any) {
      this.config = config;
    }
  },
}));

vi.mock('@mastra/core/workspace', () => ({
  LocalSkillSource: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.skillSourceConfigs.push(config);
    }
  },
  Workspace: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.workspaceConfigs.push(config);
    }
  },
}));

beforeEach(() => {
  h.agentConfigs = [];
  h.mastraConfigs = [];
  h.editorConfigs = [];
  h.libsqlStoreConfigs = [];
  h.memoryConfigs = [];
  h.observabilityConfigs = [];
  h.scorerConfigs = [];
  h.skillSourceConfigs = [];
  h.storageExporterConfigs = [];
  h.sensitiveDataFilterConfigs = [];
  h.workspaceConfigs = [];
});

function config(): ModelRuntimeConfig {
  return {
    provider: 'openrouter',
    turn: {
      model: 'openai/gpt-test',
      temperature: 0.2,
      reasoning: { enabled: true, effort: 'high' },
    },
    logline: {
      model: 'openai/gpt-logline',
      temperature: 0.5,
      reasoning: { enabled: false },
    },
  };
}

describe('createMastraAgents', () => {
  it('把静态 instructions 注册到 screenwriter、studio-screenwriter、mckee-story-critic 与 logline agent', async () => {
    const { createMastraAgents } = await import('../src/mastra');
    const { buildMckeeStoryCriticInstructions, buildScreenwriterInstructions, LOGLINE_INSTRUCTIONS } = await import(
      '../src/prompt'
    );

    const agents = createMastraAgents(config());

    expect(agents).toHaveProperty('screenwriter');
    expect(agents).toHaveProperty('studio-screenwriter');
    expect(agents).toHaveProperty('mckee-story-critic');
    expect(agents).toHaveProperty('logline');
    expect(h.agentConfigs).toHaveLength(4);

    const screenwriter = h.agentConfigs.find((agent) => agent.id === 'incipel-screenwriter')!;
    expect(screenwriter).toMatchObject({
      id: 'incipel-screenwriter',
      name: 'Incipel Screenwriter',
      model: 'openrouter/openai/gpt-test',
      instructions: buildScreenwriterInstructions(),
    });
    expect(screenwriter.instructions).toContain('可点选项只通过 propose_options 发出');
    expect(screenwriter.instructions).not.toContain('主管编剧');
    expect(screenwriter.tools).toBeUndefined();

    const studioScreenwriter = h.agentConfigs.find(
      (agent) => agent.id === 'incipel-studio-screenwriter',
    )!;
    expect(studioScreenwriter).toMatchObject({
      id: 'incipel-studio-screenwriter',
      name: 'Incipel Studio Screenwriter',
      model: 'openrouter/openai/gpt-test',
      instructions: buildScreenwriterInstructions(),
    });
    expect(studioScreenwriter.tools).toEqual(
      expect.objectContaining({
        add_character: expect.anything(),
        update_character: expect.anything(),
        request_mckee_story_critique: expect.anything(),
        read_studio_screenplay: expect.anything(),
        reset_studio_screenplay: expect.anything(),
      }),
    );

    const critic = h.agentConfigs.find((agent) => agent.id === 'incipel-mckee-story-critic')!;
    expect(critic).toMatchObject({
      id: 'incipel-mckee-story-critic',
      name: 'Incipel McKee Story Critic',
      model: 'openrouter/openai/gpt-test',
      instructions: buildMckeeStoryCriticInstructions(),
    });
    expect(critic.instructions).toContain('麦基式故事评论 Agent');
    expect(critic.tools).toBeUndefined();

    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;
    expect(logline).toMatchObject({
      id: 'incipel-logline',
      name: 'Incipel Logline',
      model: 'openrouter/openai/gpt-logline',
      instructions: LOGLINE_INSTRUCTIONS,
    });
    expect(logline.instructions).toContain('只输出这句 logline 本身');
  });

  it('为 Studio 中的 agent 启用 Evaluate 与 Review', async () => {
    const { createMastraAgents } = await import('../src/mastra');

    createMastraAgents(config());

    for (const id of [
      'incipel-screenwriter',
      'incipel-studio-screenwriter',
      'incipel-mckee-story-critic',
      'incipel-logline',
    ]) {
      const agent = h.agentConfigs.find((candidate) => candidate.id === id)!;
      expect(agent.scorers.incipelResponseCompleteness.scorer.config).toEqual({
        id: 'incipel-response-completeness',
        description: 'Scores whether an Incipel agent response contains non-empty text.',
        type: 'agent',
      });
      expect(agent.scorers.incipelResponseCompleteness.sampling).toEqual({
        type: 'ratio',
        rate: 1,
      });
      expect(agent.editor).not.toBe(false);
    }
  });

  it('给 screenwriter 与 studio-screenwriter agent 挂载山音编剧 skill,不影响 logline agent', async () => {
    const { createMastraAgents, SCREENWRITING_MASTER_SKILL_PATH } = await import('../src/mastra');

    createMastraAgents(config());

    const screenwriter = h.agentConfigs.find((agent) => agent.id === 'incipel-screenwriter')!;
    expect(screenwriter.skills).toEqual([SCREENWRITING_MASTER_SKILL_PATH]);
    const studioScreenwriter = h.agentConfigs.find(
      (agent) => agent.id === 'incipel-studio-screenwriter',
    )!;
    expect(studioScreenwriter.skills).toEqual([SCREENWRITING_MASTER_SKILL_PATH]);
    expect(SCREENWRITING_MASTER_SKILL_PATH).toMatch(/packages\/agent\/skills\/screenwriting-master$/);
    await expect(readFile(join(SCREENWRITING_MASTER_SKILL_PATH, 'SKILL.md'), 'utf8')).resolves.toContain(
      'Designed by @山音',
    );

    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;
    expect(logline.skills).toBeUndefined();

    const critic = h.agentConfigs.find((agent) => agent.id === 'incipel-mckee-story-critic')!;
    expect(critic.skills).toBeUndefined();
  });

  it('只给 Studio 调试 agent 配置 message history memory', async () => {
    const { createMastraAgents } = await import('../src/mastra');

    createMastraAgents(config());

    expect(h.memoryConfigs).toHaveLength(1);
    const studioScreenwriter = h.agentConfigs.find(
      (agent) => agent.id === 'incipel-studio-screenwriter',
    )!;
    expect(studioScreenwriter.memory).toBeDefined();
    expect(studioScreenwriter.memory.config).toEqual({
      options: {
        lastMessages: 50,
        generateTitle: true,
      },
    });

    const screenwriter = h.agentConfigs.find((agent) => agent.id === 'incipel-screenwriter')!;
    expect(screenwriter.memory).toBeUndefined();

    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;
    expect(logline.memory).toBeUndefined();

    const critic = h.agentConfigs.find((agent) => agent.id === 'incipel-mckee-story-critic')!;
    expect(critic.memory).toBeUndefined();
  });
});

describe('createMastraApp', () => {
  it('注册 MastraEditor,允许 Studio 编辑 agent instructions', async () => {
    const { createMastraApp } = await import('../src/mastra');

    createMastraApp(config());

    expect(h.mastraConfigs).toHaveLength(1);
    expect(h.editorConfigs).toEqual([{}]);
    expect(h.mastraConfigs[0]!.editor).toBeDefined();
  });

  it('注册 workspace,让 Studio 读取本地 skills', async () => {
    const { AGENT_PACKAGE_ROOT, createMastraApp } = await import('../src/mastra');

    createMastraApp(config());

    expect(h.skillSourceConfigs).toEqual([{ basePath: AGENT_PACKAGE_ROOT }]);
    expect(h.workspaceConfigs).toEqual([
      expect.objectContaining({
        id: 'incipel-agent-workspace',
        name: 'Incipel Agent Workspace',
        skills: ['skills'],
        checkSkillFileMtime: true,
      }),
    ]);
    expect(h.workspaceConfigs[0]!.skillSource).toBeDefined();
    expect(h.mastraConfigs[0]!.workspace).toBeDefined();
    expect(AGENT_PACKAGE_ROOT).toMatch(/packages\/agent\/?$/);
  });

  it('使用固定路径的 libSQL storage 保存 Studio message history', async () => {
    const { createMastraApp } = await import('../src/mastra');

    createMastraApp(config());

    expect(h.mastraConfigs).toHaveLength(1);
    expect(h.libsqlStoreConfigs).toHaveLength(1);
    expect(h.mastraConfigs[0]!.storage.config).toEqual({
      id: 'incipel-mastra-studio',
      url: expect.stringMatching(/^file:.*packages\/agent\/\.mastra-studio\.db$/),
    });
  });

  it('注册本地 observability,让 Studio 可以查看 trace 并评分', async () => {
    const { createMastraApp } = await import('../src/mastra');

    createMastraApp(config());

    expect(h.observabilityConfigs).toHaveLength(1);
    expect(h.storageExporterConfigs).toEqual([{}]);
    expect(h.sensitiveDataFilterConfigs).toEqual([{}]);
    expect(h.observabilityConfigs[0]!.configs).toEqual({
      local: {
        serviceName: 'incipel-agent-studio',
        sampling: { type: 'always' },
        exporters: [expect.objectContaining({ config: {} })],
        spanOutputProcessors: [expect.objectContaining({ config: {} })],
      },
    });
    expect(h.mastraConfigs[0]!.observability.config).toBe(h.observabilityConfigs[0]);
    expect(h.mastraConfigs[0]!.scorers).toHaveProperty('incipelResponseCompleteness');
  });
});
