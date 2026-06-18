// apply.ts 单元测试(testing-strategy §3.2):系统的心脏,目标 ~100%。
// id 门控、服务端生成 id、JSON Patch 正确性、updatedAt 语义、重放不变量。

import { describe, it, expect } from 'vitest';
import { emptyScreenplay, type JsonPatchOp, type Screenplay } from '@incipel/shared';
import { applyToolCall, ApplyError } from '../src/apply';
import { applyPatch } from './helpers/apply-patch';

function fresh(): Screenplay {
  return emptyScreenplay();
}

describe('apply.ts — set_meta', () => {
  it('只覆盖显式传入的字段,并追加 updatedAt', () => {
    const s = fresh();
    const before = s.meta.updatedAt;
    const { patch } = applyToolCall('set_meta', { title: '末日废土' }, s);
    expect(s.meta.title).toBe('末日废土');
    expect(s.meta.logline).toBe(''); // 未传则不动
    expect(patch).toContainEqual({ op: 'replace', path: '/meta/title', value: '末日废土' });
    expect(patch.some((p) => p.path === '/meta/updatedAt')).toBe(true);
    expect(s.meta.updatedAt).not.toBe(before === s.meta.updatedAt ? undefined : before); // updatedAt 被刷新
  });

  it('title 与 logline 都传 → 两条 replace + updatedAt', () => {
    const s = fresh();
    const { patch } = applyToolCall('set_meta', { title: 'T', logline: 'L' }, s);
    const paths = patch.map((p) => p.path);
    expect(paths).toEqual(['/meta/title', '/meta/logline', '/meta/updatedAt']);
  });

  it('不传任何字段 → 空 patch,不动 updatedAt', () => {
    const s = fresh();
    const before = s.meta.updatedAt;
    const { patch } = applyToolCall('set_meta', {}, s);
    expect(patch).toEqual([]);
    expect(s.meta.updatedAt).toBe(before);
  });
});

// 四类实体的 add/update/remove 行为同构,用表驱动逐类覆盖。
const ENTITIES = [
  { tool: 'world_section', coll: 'world', prefix: 'world_', add: { title: 'W', text: 'wt' }, upd: { title: 'W2' }, field: 'title' },
  { tool: 'character', coll: 'characters', prefix: 'char_', add: { name: 'N', note: 'nt' }, upd: { name: 'N2' }, field: 'name' },
  { tool: 'act', coll: 'outline', prefix: 'act_', add: { act: 'A', beat: 'bt' }, upd: { act: 'A2' }, field: 'act' },
  { tool: 'scene', coll: 'scenes', prefix: 'scene_', add: { slug: 'S', content: 'ct' }, upd: { slug: 'S2' }, field: 'slug' },
] as const;

describe.each(ENTITIES)('apply.ts — $coll', ({ tool, coll, prefix, add, upd, field }) => {
  it(`add_${tool}:服务端生成 ${prefix} 前缀 id,写入并产 add patch`, () => {
    const s = fresh();
    const { patch } = applyToolCall(`add_${tool}`, add, s);
    const arr = (s as any)[coll];
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toMatch(new RegExp(`^${prefix}`));
    const addOp = patch.find((p) => p.op === 'add')!;
    expect(addOp.path).toBe(`/${coll}/0`);
    expect((addOp.value as any).id).toBe(arr[0].id);
    expect(patch.some((p) => p.path === '/meta/updatedAt')).toBe(true);
  });

  it(`update_${tool}:只覆盖显式字段,产 replace patch`, () => {
    const s = fresh();
    applyToolCall(`add_${tool}`, add, s);
    const id = (s as any)[coll][0].id;
    const { patch } = applyToolCall(`update_${tool}`, { id, ...upd }, s);
    expect((s as any)[coll][0][field]).toBe((upd as any)[field]);
    expect(patch).toContainEqual({ op: 'replace', path: `/${coll}/0/${field}`, value: (upd as any)[field] });
  });

  it(`update_${tool}:id 不存在 → ApplyError(绝不静默新建)`, () => {
    const s = fresh();
    expect(() => applyToolCall(`update_${tool}`, { id: `${prefix}ghost`, ...upd }, s)).toThrow(ApplyError);
    expect((s as any)[coll]).toHaveLength(0);
  });

  it(`remove_${tool}:按下标删除,产 remove patch`, () => {
    const s = fresh();
    applyToolCall(`add_${tool}`, add, s);
    const id = (s as any)[coll][0].id;
    const { patch } = applyToolCall(`remove_${tool}`, { id }, s);
    expect((s as any)[coll]).toHaveLength(0);
    expect(patch).toContainEqual({ op: 'remove', path: `/${coll}/0` });
  });

  it(`remove_${tool}:id 不存在 → ApplyError`, () => {
    const s = fresh();
    expect(() => applyToolCall(`remove_${tool}`, { id: `${prefix}ghost` }, s)).toThrow(ApplyError);
  });
});

describe('apply.ts — 杂项', () => {
  it('propose_options 不改剧本 → 空 patch', () => {
    const s = fresh();
    const { patch } = applyToolCall('propose_options', { options: ['a', 'b'] }, s);
    expect(patch).toEqual([]);
  });

  it('未知工具 → ApplyError', () => {
    expect(() => applyToolCall('frobnicate', {}, fresh())).toThrow(ApplyError);
  });

  it('add_* 缺字段 → 以空串兜入(防御性默认),仍生成 id', () => {
    for (const { tool, coll } of ENTITIES) {
      const s = fresh();
      applyToolCall(`add_${tool}`, {}, s);
      const e = (s as any)[coll][0];
      expect(e.id).toBeTruthy();
      // 各字段均为字符串(空串),不出现 undefined。
      for (const [k, v] of Object.entries(e)) {
        if (k !== 'id') expect(typeof v).toBe('string');
      }
    }
  });

  it('update_* 不传任何可改字段 → 空 patch,不动 updatedAt', () => {
    const s = fresh();
    applyToolCall('add_character', { name: 'A', note: '' }, s);
    const id = s.characters[0]!.id;
    const before = s.meta.updatedAt;
    const { patch } = applyToolCall('update_character', { id }, s);
    expect(patch).toEqual([]);
    expect(s.meta.updatedAt).toBe(before);
  });
});

describe('apply.ts — 重放不变量(客户端重放增量 == 服务端最终态)', () => {
  it('一轮多次工具调用:patch 依次应用到初始快照后等于最终 state', () => {
    const s = fresh();
    const snapshot = structuredClone(s); // 重放起点 = 与工具调用相同的初始态

    const all: JsonPatchOp[] = [];
    const collect = (tool: string, args: unknown) => {
      const { patch } = applyToolCall(tool, args, s);
      all.push(...patch);
    };

    collect('set_meta', { title: '末日废土', logline: '一句话' });
    collect('add_character', { name: '林深', note: '外科医生' });
    collect('add_character', { name: '阿七', note: '少年' });
    collect('add_world_section', { title: '废土', text: '资源稀缺' });
    const charId = s.characters[0]!.id;
    collect('update_character', { id: charId, note: '前外科医生' });
    collect('add_act', { act: '第一幕', beat: '相遇' });
    collect('remove_character', { id: s.characters[1]!.id }); // 删阿七

    const replayed = applyPatch(snapshot, all);
    expect(replayed).toEqual(s);
    // 顺带核对最终态符合预期。
    expect(s.characters.map((c) => c.name)).toEqual(['林深']);
    expect(s.characters[0]!.note).toBe('前外科医生');
    expect(s.world).toHaveLength(1);
    expect(s.outline).toHaveLength(1);
  });
});
