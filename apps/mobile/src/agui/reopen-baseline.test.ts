import { describe, expect, it } from 'vitest';
import { emptyScreenplay, type Screenplay } from '@incipel/shared';
import { baselineBeforeLastTurn } from './reopen-baseline';

function withWorld(...titles: string[]): Screenplay {
  return {
    ...emptyScreenplay(),
    world: titles.map((t, i) => ({ id: `world_${i}`, title: t, text: `${t} 正文` })),
  };
}

describe('baselineBeforeLastTurn', () => {
  // 回归:重新打开会话时,最后一条助手消息要照样显示它那一轮新增的世界观内联卡片。
  // 反推基线 = 当前剧本去掉本轮 add 的实体;diffCard(基线, 当前) 即还原该轮新增。
  it('removes entities added by the last turn so they diff back as this-turn additions', () => {
    const state = withWorld('旧设定', '现代城市的数字阴影');
    const lastTurnDeltas = [
      { op: 'add', path: '/world/1', value: { id: 'world_1', title: '现代城市的数字阴影', text: '...' } },
      { op: 'replace', path: '/meta/updatedAt', value: '2026-06-23T12:34:55.141Z' },
    ];

    const base = baselineBeforeLastTurn(state, lastTurnDeltas);
    // 基线里只剩上一轮就存在的实体
    expect(base.world.map((w) => w.id)).toEqual(['world_0']);
    // 当前剧本不动
    expect(state.world.map((w) => w.id)).toEqual(['world_0', 'world_1']);
  });

  it('returns the same state when the last turn added nothing (only replace ops)', () => {
    const state = withWorld('设定甲');
    const base = baselineBeforeLastTurn(state, [
      { op: 'replace', path: '/meta/updatedAt', value: 'x' },
    ]);
    expect(base).toBe(state); // 无新增:原样返回
  });

  it('ignores nested attr adds (attr id is not a top-level entity id)', () => {
    const state: Screenplay = {
      ...emptyScreenplay(),
      characters: [{ id: 'char_0', name: '老师', role: '主角', attrs: [{ id: 'attr_9', label: '外貌', value: '沉默' }] }],
    };
    // 给既有人物加 attr:add 的是 attr 对象(id=attr_9),不是新人物
    const base = baselineBeforeLastTurn(state, [
      { op: 'add', path: '/characters/0/attrs/0', value: { id: 'attr_9', label: '外貌', value: '沉默' } },
    ]);
    // 人物仍保留在基线里(没被当成本轮新增人物移除)
    expect(base.characters.map((c) => c.id)).toEqual(['char_0']);
  });

  it('tolerates null / non-array deltas', () => {
    const state = withWorld('设定');
    expect(baselineBeforeLastTurn(state, null)).toBe(state);
    expect(baselineBeforeLastTurn(state, undefined)).toBe(state);
  });
});
