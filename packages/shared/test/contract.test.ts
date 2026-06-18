// @incipel/shared 契约单元测试(testing-strategy §3.1):id 枚举门控与阶段派生。
// 纯函数、确定性、无 I/O。

import { describe, it, expect } from 'vitest';
import { buildToolSchemas, idSetsOf, deriveStage, emptyScreenplay } from '../src/index';

describe('buildToolSchemas — id 枚举门控', () => {
  it('某类实体为空时,不暴露其 update_/remove_', () => {
    const tools = buildToolSchemas(idSetsOf(emptyScreenplay()));
    expect(tools.add_character).toBeDefined();
    expect(tools.update_character).toBeUndefined();
    expect(tools.remove_character).toBeUndefined();
    expect(tools.update_world_section).toBeUndefined();
  });

  it('非空时,update_ 的 id 被锁定为当前这组 id 的枚举', () => {
    const sp = { ...emptyScreenplay(), characters: [{ id: 'char_x', name: 'A', note: '' }] };
    const tools = buildToolSchemas(idSetsOf(sp));
    expect(tools.update_character).toBeDefined();
    expect(() => tools.update_character!.parse({ id: 'char_x', name: 'B' })).not.toThrow();
    expect(() => tools.update_character!.parse({ id: 'char_ghost' })).toThrow();
  });
});

describe('deriveStage — 优先级 scenes > outline > characters > world > idea', () => {
  it('空剧本 → idea', () => {
    expect(deriveStage(emptyScreenplay())).toBe('idea');
  });
  it('仅 world → world', () => {
    expect(deriveStage({ ...emptyScreenplay(), world: [{ id: 'w', title: '', text: '' }] })).toBe('world');
  });
  it('characters 压过 world', () => {
    expect(
      deriveStage({
        ...emptyScreenplay(),
        world: [{ id: 'w', title: '', text: '' }],
        characters: [{ id: 'c', name: '', note: '' }],
      }),
    ).toBe('characters');
  });
  it('scenes 压过 outline', () => {
    expect(
      deriveStage({
        ...emptyScreenplay(),
        outline: [{ id: 'a', act: '', beat: '' }],
        scenes: [{ id: 's', slug: '', content: '' }],
      }),
    ).toBe('scenes');
  });
});
