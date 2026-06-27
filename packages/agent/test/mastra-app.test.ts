import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelRuntimeConfig } from '../src/model/config';

const h = vi.hoisted(() => ({
  agentConfigs: [] as any[],
  mastraConfigs: [] as any[],
  compositeStoreConfigs: [] as any[],
  duckdbStoreConfigs: [] as any[],
  duckdbStoreCloseConfigs: [] as any[],
  editorConfigs: [] as any[],
  libsqlStoreConfigs: [] as any[],
  libsqlStoreCloseConfigs: [] as any[],
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

    async close() {
      h.libsqlStoreCloseConfigs.push(this.config);
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
  MastraCompositeStore: class {
    config: any;

    constructor(config: any) {
      this.config = config;
      h.compositeStoreConfigs.push(config);
    }
  },
}));

vi.mock('@mastra/duckdb', () => ({
  DuckDBStore: class {
    config: any;
    observability: any;

    constructor(config?: any) {
      this.config = config ?? {};
      this.observability = { kind: 'duckdb-observability', config: this.config };
      h.duckdbStoreConfigs.push(this.config);
    }

    async close() {
      h.duckdbStoreCloseConfigs.push(this.config);
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
  h.compositeStoreConfigs = [];
  h.duckdbStoreConfigs = [];
  h.duckdbStoreCloseConfigs = [];
  h.editorConfigs = [];
  h.libsqlStoreConfigs = [];
  h.libsqlStoreCloseConfigs = [];
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

function expectOpenRouterModel(model: any, modelId: string, extraBody?: Record<string, unknown>) {
  expect(model).toMatchObject({
    provider: 'openrouter',
    modelId,
  });
  if (extraBody) {
    expect(model.settings.extraBody).toEqual(extraBody);
  } else {
    expect(model.settings.extraBody).toBeUndefined();
  }
}

function openRouterSuccessResponse() {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'openai/gpt-test',
    provider: 'openai',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'ok',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
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
      defaultOptions: {
        modelSettings: { temperature: 0.2 },
      },
      instructions: buildScreenwriterInstructions(),
    });
    expectOpenRouterModel(screenwriter.model, 'openai/gpt-test', {
      reasoning: { enabled: true, effort: 'high' },
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
      defaultOptions: {
        modelSettings: { temperature: 0.2 },
      },
      instructions: buildScreenwriterInstructions(),
      editor: { instructions: true },
    });
    expectOpenRouterModel(studioScreenwriter.model, 'openai/gpt-test', {
      reasoning: { enabled: true, effort: 'high' },
    });
    expect(studioScreenwriter.tools).toEqual(
      expect.objectContaining({
        add_character: expect.anything(),
        update_character: expect.anything(),
        request_mckee_story_critique: expect.anything(),
        read_studio_screenplay: expect.anything(),
        reset_studio_screenplay: expect.anything(),
        openrouter_web_search: expect.anything(),
        openrouter_web_fetch: expect.anything(),
      }),
    );
    expect(studioScreenwriter.tools.openrouter_web_search).toMatchObject({
      type: 'provider',
      id: 'openrouter.web_search',
    });
    expect(studioScreenwriter.tools.openrouter_web_fetch).toMatchObject({
      type: 'provider',
      id: 'openrouter.web_fetch',
      args: {},
    });
    expect(studioScreenwriter.inputProcessors).toEqual([
      expect.objectContaining({ id: 'openrouter-web-tool-policy' }),
    ]);

    const critic = h.agentConfigs.find((agent) => agent.id === 'incipel-mckee-story-critic')!;
    expect(critic).toMatchObject({
      id: 'incipel-mckee-story-critic',
      name: 'Incipel McKee Story Critic',
      defaultOptions: {
        modelSettings: { temperature: 0.2 },
      },
      instructions: buildMckeeStoryCriticInstructions(),
    });
    expectOpenRouterModel(critic.model, 'openai/gpt-test', {
      reasoning: { enabled: true, effort: 'high' },
    });
    expect(critic.instructions).toContain('麦基式故事评论 Agent');
    expect(critic.tools).toBeUndefined();

    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;
    expect(logline).toMatchObject({
      id: 'incipel-logline',
      name: 'Incipel Logline',
      defaultOptions: {
        modelSettings: { temperature: 0.5 },
      },
      instructions: LOGLINE_INSTRUCTIONS,
    });
    expectOpenRouterModel(logline.model, 'openai/gpt-logline');
    expect(logline.instructions).toContain('只输出这句 logline 本身');
  });

  it('只给 studio-screenwriter 挂载 OpenRouter web search 与 web fetch server tools', async () => {
    const { createMastraAgents } = await import('../src/mastra');

    createMastraAgents(config());

    const studioScreenwriter = h.agentConfigs.find(
      (agent) => agent.id === 'incipel-studio-screenwriter',
    )!;
    const screenwriter = h.agentConfigs.find((agent) => agent.id === 'incipel-screenwriter')!;
    const critic = h.agentConfigs.find((agent) => agent.id === 'incipel-mckee-story-critic')!;
    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;

    expect(Object.keys(studioScreenwriter.tools)).toEqual(
      expect.arrayContaining(['openrouter_web_search', 'openrouter_web_fetch']),
    );
    expect(screenwriter.tools).toBeUndefined();
    expect(critic.tools).toBeUndefined();
    expect(logline.tools).toBeUndefined();
  });

  it('studio-screenwriter 发送给 OpenRouter 的 request body 同时包含本地 function tool 和 server tools', async () => {
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const bodies: any[] = [];
    const fetchStub = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(openRouterSuccessResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);

    try {
      const { createMastraAgents } = await import('../src/mastra');

      createMastraAgents(config());

      const studioScreenwriter = h.agentConfigs.find(
        (agent) => agent.id === 'incipel-studio-screenwriter',
      )!;
      await studioScreenwriter.model.doGenerate({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: '查找近期电影资料。' }],
          },
        ],
        tools: [
          {
            type: 'function',
            name: 'read_studio_screenplay',
            description: 'Read the current Studio screenplay.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: 'openrouter_web_search',
            ...studioScreenwriter.tools.openrouter_web_search,
          },
          {
            name: 'openrouter_web_fetch',
            ...studioScreenwriter.tools.openrouter_web_fetch,
          },
        ],
        toolChoice: { type: 'auto' },
      });

      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(bodies[0]!.tools).toEqual([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'read_studio_screenplay' }),
        }),
        expect.objectContaining({ type: 'openrouter:web_search' }),
        expect.objectContaining({ type: 'openrouter:web_fetch' }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      if (originalApiKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalApiKey;
      }
    }
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
    expect(h.compositeStoreConfigs).toHaveLength(1);
    expect(h.compositeStoreConfigs[0]!.default.config).toEqual({
      id: 'incipel-mastra-studio',
      url: expect.stringMatching(/^file:.*packages\/agent\/\.mastra-studio\.db$/),
    });
  });

  it('使用 DuckDB storage 支持 Studio observability 查询', async () => {
    const { createMastraApp } = await import('../src/mastra');

    createMastraApp(config());

    expect(h.duckdbStoreConfigs).toEqual([
      {
        path: expect.stringMatching(/packages\/agent\/\.mastra-studio\.db\.duckdb$/),
      },
    ]);
    expect(h.compositeStoreConfigs).toHaveLength(1);
    expect(h.compositeStoreConfigs[0]).toMatchObject({
      id: 'incipel-mastra-studio',
      domains: {
        observability: expect.objectContaining({
          kind: 'duckdb-observability',
        }),
      },
    });
    expect(h.mastraConfigs[0]!.storage.config).toBe(h.compositeStoreConfigs[0]);
  });

  it('关闭 Studio storage 时释放 libSQL 与 DuckDB storage', async () => {
    const { createMastraApp } = await import('../src/mastra');

    createMastraApp(config());

    await h.mastraConfigs[0]!.storage.close();

    expect(h.libsqlStoreCloseConfigs).toEqual([
      {
        id: 'incipel-mastra-studio',
        url: expect.stringMatching(/^file:.*packages\/agent\/\.mastra-studio\.db$/),
      },
    ]);
    expect(h.duckdbStoreCloseConfigs).toEqual([
      {
        path: expect.stringMatching(/packages\/agent\/\.mastra-studio\.db\.duckdb$/),
      },
    ]);
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
