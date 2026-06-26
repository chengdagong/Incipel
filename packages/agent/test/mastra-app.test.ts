import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelRuntimeConfig } from '../src/model/config';

const h = vi.hoisted(() => ({
  agentConfigs: [] as any[],
  mastraConfigs: [] as any[],
  editorConfigs: [] as any[],
  skillSourceConfigs: [] as any[],
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

vi.mock('@mastra/editor', () => ({
  MastraEditor: class {
    config: any;

    constructor(config?: any) {
      this.config = config;
      h.editorConfigs.push(config ?? {});
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
  h.skillSourceConfigs = [];
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
});
