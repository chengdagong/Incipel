import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelRuntimeConfig } from '../src/model/config';

const h = vi.hoisted(() => ({
  agentConfigs: [] as any[],
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

beforeEach(() => {
  h.agentConfigs = [];
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
  it('把静态 instructions 注册到 screenwriter 与 logline agent', async () => {
    const { createMastraAgents } = await import('../src/mastra-app');
    const { buildScreenwriterInstructions, LOGLINE_INSTRUCTIONS } = await import('../src/prompt');

    const agents = createMastraAgents(config());

    expect(agents).toHaveProperty('screenwriter');
    expect(agents).toHaveProperty('logline');
    expect(h.agentConfigs).toHaveLength(2);

    const screenwriter = h.agentConfigs.find((agent) => agent.id === 'incipel-screenwriter')!;
    expect(screenwriter).toMatchObject({
      id: 'incipel-screenwriter',
      name: 'Incipel Screenwriter',
      model: 'openrouter/openai/gpt-test',
      instructions: buildScreenwriterInstructions(),
    });
    expect(screenwriter.instructions).toContain('可点选项只通过 propose_options 发出');
    expect(screenwriter.instructions).not.toContain('主管编剧');

    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;
    expect(logline).toMatchObject({
      id: 'incipel-logline',
      name: 'Incipel Logline',
      model: 'openrouter/openai/gpt-logline',
      instructions: LOGLINE_INSTRUCTIONS,
    });
    expect(logline.instructions).toContain('只输出这句 logline 本身');
  });

  it('只给 screenwriter agent 挂载山音编剧 skill,不影响 logline agent', async () => {
    const { createMastraAgents, SCREENWRITING_MASTER_SKILL_PATH } = await import('../src/mastra-app');

    createMastraAgents(config());

    const screenwriter = h.agentConfigs.find((agent) => agent.id === 'incipel-screenwriter')!;
    expect(screenwriter.skills).toEqual([SCREENWRITING_MASTER_SKILL_PATH]);
    expect(SCREENWRITING_MASTER_SKILL_PATH).toMatch(/packages\/agent\/skills\/screenwriting-master$/);
    await expect(readFile(join(SCREENWRITING_MASTER_SKILL_PATH, 'SKILL.md'), 'utf8')).resolves.toContain(
      'Designed by @山音',
    );

    const logline = h.agentConfigs.find((agent) => agent.id === 'incipel-logline')!;
    expect(logline.skills).toBeUndefined();
  });
});
