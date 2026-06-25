import { describe, expect, it } from 'vitest';
import type { ModelRuntimeConfig } from '../src/model/config';

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

describe('Mastra screenwriter skills', () => {
  it('screenwriter 可经 Mastra skill API 读取山音编剧 skill,logline 不挂载该 skill', async () => {
    const { createMastraAgents } = await import('../src/mastra-app');

    const agents = createMastraAgents(config());
    const screenwriterSkills = await agents.screenwriter.listSkills();

    expect(screenwriterSkills.map((skill) => skill.name)).toContain('screenwriting-master');

    const skill = await agents.screenwriter.getSkill('screenwriting-master');
    expect(skill?.instructions).toContain('Designed by @山音');
    expect(skill?.instructions).toContain('用户明确要求直接写、不要提问或一次写完');
    expect(skill?.instructions).toContain('不要套用分步暂停规则');
    expect(skill?.references).toEqual(
      expect.arrayContaining([
        'core-methodology.md',
        'format-feature.md',
        'format-series.md',
        'format-short.md',
        'format-ultrashort.md',
      ]),
    );

    await expect(agents.logline.listSkills()).resolves.toEqual([]);
  });
});
