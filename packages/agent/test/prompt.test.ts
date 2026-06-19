// prompt.ts 单元测试(testing-strategy §3.6):剧本序列化、每轮 prompt 拼装、logline prompt。

import { describe, it, expect } from 'vitest';
import { emptyScreenplay, type Screenplay } from '@incipel/shared';
import {
  serializeScreenplay,
  buildPrompt,
  buildLoglinePrompt,
  buildSystem,
  RECENT_MESSAGE_LIMIT,
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

  it('空剧本:标题/logline 显示「(未定)」,阶段为灵感', () => {
    const text = serializeScreenplay(emptyScreenplay());
    expect(text).toContain('标题: (未定)');
    expect(text).toContain('logline: (未定)');
    expect(text).toContain('阶段: 灵感');
  });
});

describe('buildPrompt', () => {
  it('system 为 buildSystem() 输出(默认助手名);prompt 含剧本快照、最近对话与本轮消息', () => {
    const recent: PromptMessage[] = [
      { role: 'user', text: '想写末日废土' },
      { role: 'assistant', text: '好,先定个 logline' },
    ];
    const { system, prompt } = buildPrompt({ state: sample(), recent, userMessage: '给两个人物' });
    expect(system).toBe(buildSystem());
    expect(prompt).toContain('# 当前剧本');
    expect(prompt).toContain('# 最近对话');
    expect(prompt).toContain('用户: 想写末日废土');
    expect(prompt).toContain('主管编剧: 好,先定个 logline'); // 助手发言用默认显示名标注
    expect(prompt).toContain('# 本轮用户消息\n给两个人物');
  });

  it('最近对话被截到 RECENT_MESSAGE_LIMIT', () => {
    const recent: PromptMessage[] = Array.from({ length: RECENT_MESSAGE_LIMIT + 5 }, (_, i) => ({
      role: 'user' as const,
      text: `msg-${i}`,
    }));
    const { prompt } = buildPrompt({ state: emptyScreenplay(), recent, userMessage: 'x' });
    // 最早的 5 条被截掉。
    expect(prompt).not.toContain('msg-0');
    expect(prompt).toContain(`msg-${RECENT_MESSAGE_LIMIT + 4}`);
  });

  it('无最近对话时,「最近对话」段被过滤掉', () => {
    const { prompt } = buildPrompt({ state: emptyScreenplay(), recent: [], userMessage: 'x' });
    expect(prompt).not.toContain('# 最近对话');
    expect(prompt).toContain('# 本轮用户消息');
  });
});

describe('buildLoglinePrompt', () => {
  it('有灵感 → prompt 引用该灵感', () => {
    const { prompt } = buildLoglinePrompt('一个怕黑的灯塔看守人');
    expect(prompt).toContain('一个怕黑的灯塔看守人');
  });

  it('无灵感 → 随机生成措辞', () => {
    const { prompt } = buildLoglinePrompt();
    expect(prompt).toContain('随机');
  });
});
