// @incipel/shared 契约单元测试(testing-strategy §3.1):id 枚举门控、阶段派生、空剧本、事件/wire 格式。
// 纯函数、确定性、无 I/O。

import { describe, it, expect } from 'vitest';
import {
  buildToolSchemas,
  idSetsOf,
  deriveStage,
  emptyScreenplay,
  optionsEvent,
  sse,
  ACCENT_OPTIONS,
  EventType,
  OPTIONS_EVENT_NAME,
} from '../src/index';

describe('buildToolSchemas — id 枚举门控', () => {
  it('某类实体为空时,不暴露其 update_/remove_', () => {
    const tools = buildToolSchemas(idSetsOf(emptyScreenplay()));
    expect(tools.add_character).toBeDefined();
    expect(tools.update_character).toBeUndefined();
    expect(tools.remove_character).toBeUndefined();
    expect(tools.update_world_section).toBeUndefined();
  });

  it('非空时,update_ 的 id 被锁定为当前这组 id 的枚举', () => {
    const sp = { ...emptyScreenplay(), characters: [{ id: 'char_x', name: 'A', role: '', attrs: [] }] };
    const tools = buildToolSchemas(idSetsOf(sp));
    expect(tools.update_character).toBeDefined();
    expect(() => tools.update_character!.parse({ id: 'char_x', name: 'B' })).not.toThrow();
    expect(() => tools.update_character!.parse({ id: 'char_ghost' })).toThrow();
  });

  it('四类实体都非空时,各自的 update_/remove_ 都暴露且 id 被枚举锁定', () => {
    const sp = {
      ...emptyScreenplay(),
      world: [{ id: 'world_x', title: '', text: '' }],
      characters: [{ id: 'char_x', name: '', role: '', attrs: [] }],
      outline: [{ id: 'act_x', act: '', beat: '' }],
      scenes: [{ id: 'scene_x', slug: '', content: '' }],
    };
    const t = buildToolSchemas(idSetsOf(sp));
    for (const tool of ['update_world_section', 'remove_world_section', 'update_act', 'remove_act', 'update_scene', 'remove_scene']) {
      expect(t[tool]).toBeDefined();
    }
    expect(() => t.update_world_section!.parse({ id: 'world_x', title: 'T' })).not.toThrow();
    expect(() => t.remove_act!.parse({ id: 'act_x' })).not.toThrow();
    expect(() => t.update_scene!.parse({ id: 'scene_ghost' })).toThrow();
  });

  it('人物属性:有人物才暴露 add_character_attr;有属性才暴露 update/remove_character_attr', () => {
    expect(buildToolSchemas(idSetsOf(emptyScreenplay())).add_character_attr).toBeUndefined();

    const withChar = buildToolSchemas(
      idSetsOf({ ...emptyScreenplay(), characters: [{ id: 'char_x', name: '', role: '', attrs: [] }] }),
    );
    expect(withChar.add_character_attr).toBeDefined();
    expect(withChar.update_character_attr).toBeUndefined(); // 还没有属性
    expect(withChar.remove_character_attr).toBeUndefined();

    const withAttr = buildToolSchemas(
      idSetsOf({
        ...emptyScreenplay(),
        characters: [{ id: 'char_x', name: '', role: '', attrs: [{ id: 'cattr_x', label: 'l', value: 'v' }] }],
      }),
    );
    expect(withAttr.update_character_attr).toBeDefined();
    expect(() => withAttr.add_character_attr!.parse({ characterId: 'char_x', label: '外貌', value: '高瘦' })).not.toThrow();
    expect(() => withAttr.add_character_attr!.parse({ characterId: 'char_ghost', label: 'l', value: 'v' })).toThrow();
    expect(() => withAttr.update_character_attr!.parse({ attrId: 'cattr_x', value: 'v2' })).not.toThrow();
    expect(() => withAttr.update_character_attr!.parse({ attrId: 'cattr_ghost' })).toThrow();
  });
});

describe('idSetsOf', () => {
  it('从剧本抽出各类 id 集合(含人物属性 attrId,跨人物扁平收集)', () => {
    const sp = {
      ...emptyScreenplay(),
      world: [{ id: 'world_a', title: '', text: '' }],
      characters: [
        { id: 'char_a', name: '', role: '', attrs: [{ id: 'cattr_a', label: '外貌', value: '' }] },
        { id: 'char_b', name: '', role: '', attrs: [] },
      ],
      outline: [{ id: 'act_a', act: '', beat: '' }],
      scenes: [{ id: 'scene_a', slug: '', content: '' }],
    };
    expect(idSetsOf(sp)).toEqual({
      world: ['world_a'],
      characters: ['char_a', 'char_b'],
      characterAttrs: ['cattr_a'],
      acts: ['act_a'],
      scenes: ['scene_a'],
    });
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
        characters: [{ id: 'c', name: '', role: '', attrs: [] }],
      }),
    ).toBe('characters');
  });
  it('仅 outline → outline', () => {
    expect(deriveStage({ ...emptyScreenplay(), outline: [{ id: 'a', act: '', beat: '' }] })).toBe('outline');
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

describe('emptyScreenplay', () => {
  it('默认 accent 为 ACCENT_OPTIONS[0],各区块为空', () => {
    const s = emptyScreenplay();
    expect(s.meta.accent).toBe(ACCENT_OPTIONS[0]);
    expect(s.meta.title).toBe('');
    expect(s.meta.logline).toBe('');
    expect([s.world, s.characters, s.outline, s.scenes].every((a) => a.length === 0)).toBe(true);
    expect(typeof s.meta.updatedAt).toBe('string');
  });
  it('可指定 accent', () => {
    expect(emptyScreenplay('#5B7B6F').meta.accent).toBe('#5B7B6F');
  });
});

describe('optionsEvent / sse', () => {
  it('optionsEvent 产出 CUSTOM{name:"options"}', () => {
    const ev = optionsEvent(['a', 'b']) as any;
    expect(ev.type).toBe(EventType.CUSTOM);
    expect(ev.name).toBe(OPTIONS_EVENT_NAME);
    expect(ev.value).toEqual(['a', 'b']);
  });
  it('sse 把事件序列化成一帧 SSE data 帧', () => {
    expect(sse({ type: 'X', a: 1 })).toBe('data: {"type":"X","a":1}\n\n');
  });
});
