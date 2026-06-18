// id.ts 单元测试(testing-strategy §3.6):服务端生成 id 的前缀与基本性质。

import { describe, it, expect } from 'vitest';
import { newId, newWorldSectionId, newCharacterId, newActId, newSceneId } from '../src/id';

describe('id.ts — 前缀与形态', () => {
  it.each([
    ['world', 'world_', newWorldSectionId],
    ['char', 'char_', newCharacterId],
    ['act', 'act_', newActId],
    ['scene', 'scene_', newSceneId],
  ] as const)('%s id 带 %s 前缀', (_kind, prefix, gen) => {
    const id = gen();
    expect(id.startsWith(prefix)).toBe(true);
    // <prefix><nanoid(12)>:前缀后恰好 12 个字符。
    expect(id.length).toBe(prefix.length + 12);
  });

  it('newId 按 kind 取前缀', () => {
    expect(newId('char').startsWith('char_')).toBe(true);
    expect(newId('world').startsWith('world_')).toBe(true);
  });

  it('同类两次生成不相同', () => {
    expect(newCharacterId()).not.toBe(newCharacterId());
  });
});
