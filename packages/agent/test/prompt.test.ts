// prompt.ts 单元测试(testing-strategy §3.6):剧本序列化、每次回应的 prompt 拼装、logline prompt。

import { describe, it, expect } from 'vitest';
import { emptyScreenplay, type Screenplay } from '@incipel/shared';
import {
  serializeScreenplay,
  buildPrompt,
  buildLoglinePrompt,
  buildSystem,
  type PromptMessage,
} from '../src/prompt';

function sample(): Screenplay {
  return {
    ...emptyScreenplay(),
    meta: { title: '末日废土', logline: '一句话', accent: '#C2724E', updatedAt: '2026-06-18T00:00:00Z' },
    world: [{ id: 'world_a', title: '废土', text: '资源稀缺' }],
    characters: [
      { id: 'char_a', name: '林深', role: '医生', attrs: [{ id: 'cattr_a', label: '外貌', value: '高瘦' }] },
      { id: 'char_b', name: '阿七', role: '少年', attrs: [] },
    ],
    outline: [{ id: 'act_a', act: '第一幕', beat: '相遇' }],
    scenes: [{ id: 'scene_a', slug: '内景 诊所 — 夜', content: '林深:别动。' }],
  };
}

describe('serializeScreenplay', () => {
  it('标题/logline 与各区块计数、[id] 标注', () => {
    const text = serializeScreenplay(sample());
    expect(text).toContain('标题: 末日废土');
    expect(text).toContain('logline: 一句话');
    expect(text).toContain('## 世界观(1 节)');
    expect(text).toContain('## 人物(2)');
    expect(text).toContain('## 大纲(1 幕)');
    expect(text).toContain('## 分场(1)');
    expect(text).toContain('[world_a]');
    expect(text).toContain('[char_a]');
    expect(text).toContain('[cattr_a]'); // 人物属性带 id 标注(#12 结构化属性)
    expect(text).toContain('外貌: 高瘦');
    expect(text).toContain('[scene_a]');
  });

  it('空剧本:标题/logline 显示「(未定)」', () => {
    const text = serializeScreenplay(emptyScreenplay());
    expect(text).toContain('标题: (未定)');
    expect(text).toContain('logline: (未定)');
  });
});

describe('buildPrompt', () => {
  it('system 为 buildSystem() 输出(默认助手名);prompt 含剧本快照、对话历史与本次用户消息', () => {
    const history: PromptMessage[] = [
      { role: 'user', text: '想写末日废土' },
      { role: 'assistant', text: '好,先定个 logline' },
    ];
    const { system, prompt } = buildPrompt({ state: sample(), history, userMessage: '给两个人物' });
    expect(system).toBe(buildSystem());
    expect(prompt).toContain('# 当前剧本');
    expect(prompt).toContain('# 对话历史');
    expect(prompt).toContain('用户: 想写末日废土');
    expect(prompt).toContain('主管编剧: 好,先定个 logline'); // 助手发言用默认显示名标注
    expect(prompt).toContain('# 本次用户消息\n给两个人物');
  });

  it('system 不再要求模型先判断「引导 / 接管」模式', () => {
    const system = buildSystem();
    expect(system).toContain('# 每次如何回应用户');
    expect(system).toContain('如果用户意图清楚,而且足以推进剧本');
    expect(system).not.toContain('引导');
    expect(system).not.toContain('接管');
    expect(system).not.toContain('当前模式');
  });

  it('完整对话历史不截断:全部历史消息都进入 prompt(ADR-0010)', () => {
    const history: PromptMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      text: `msg-${i}`,
    }));
    const { prompt } = buildPrompt({ state: emptyScreenplay(), history, userMessage: 'x' });
    // 不再截断:最早与最新的都在。
    expect(prompt).toContain('msg-0');
    expect(prompt).toContain('msg-29');
  });

  it('无对话历史时,「对话历史」段被过滤掉', () => {
    const { prompt } = buildPrompt({ state: emptyScreenplay(), history: [], userMessage: 'x' });
    expect(prompt).not.toContain('# 对话历史');
    expect(prompt).toContain('# 本次用户消息');
  });
});

describe('buildLoglinePrompt', () => {
  it('即使传入已有输入,也生成全新 logline', () => {
    const { prompt } = buildLoglinePrompt('一个怕黑的灯塔看守人');
    expect(prompt).toContain('随机生成一句全新的 logline');
    expect(prompt).not.toContain('一个怕黑的灯塔看守人');
  });

  it('无灵感 → 随机生成措辞', () => {
    const { prompt } = buildLoglinePrompt();
    expect(prompt).toContain('随机');
  });
});
