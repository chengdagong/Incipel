import { describe, expect, it } from 'vitest';
import { emptyScreenplay } from '@incipel/shared';
import { applyScreenplayTitle, canEditSessionTitle, normalizeSessionTitle, sessionTitleForDisplay } from './session-title';

describe('normalizeSessionTitle', () => {
  it('去掉首尾空白并限制为 80 个字符', () => {
    expect(normalizeSessionTitle(`  ${'甲'.repeat(90)}  `)).toBe('甲'.repeat(80));
  });

  it('允许清空标题', () => {
    expect(normalizeSessionTitle('   ')).toBe('');
  });
});

describe('applyScreenplayTitle', () => {
  it('只更新 meta.title 与 meta.updatedAt', () => {
    const screenplay = {
      ...emptyScreenplay(),
      world: [{ id: 'world_1', title: '旧世界', text: '正文' }],
    };

    const next = applyScreenplayTitle(screenplay, '新标题', '2026-06-24T00:00:00.000Z');

    expect(next.meta.title).toBe('新标题');
    expect(next.meta.updatedAt).toBe('2026-06-24T00:00:00.000Z');
    expect(next.world).toBe(screenplay.world);
  });
});

describe('sessionTitleForDisplay', () => {
  it('优先显示 sessions.title,再显示剧本标题,最后显示 fallback', () => {
    expect(sessionTitleForDisplay(' 用户标题 ', '剧本标题', '无题')).toBe('用户标题');
    expect(sessionTitleForDisplay('', ' 剧本标题 ', '无题')).toBe('剧本标题');
    expect(sessionTitleForDisplay('', '', '无题')).toBe('无题');
  });
});

describe('canEditSessionTitle', () => {
  it('运行中或恢复历史中都不允许编辑标题', () => {
    expect(canEditSessionTitle({ isRunning: false, hydrating: false })).toBe(true);
    expect(canEditSessionTitle({ isRunning: true, hydrating: false })).toBe(false);
    expect(canEditSessionTitle({ isRunning: false, hydrating: true })).toBe(false);
  });
});
