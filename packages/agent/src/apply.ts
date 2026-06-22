// 把一次模型工具调用应用到内存中的 Screenplay,返回该次改动的 RFC 6902 JSON Patch
// (即 AG-UI STATE_DELTA 的载荷)。run.ts 每应用一次就发一条 STATE_DELTA。
//
// 契约(见 docs/adr/0001):
// - add_* 由 src/id.ts 生成 id(模型无权自造)。
// - update_* / remove_* 再次校验 id 必须存在(防御性二次门控,工具 schema 已用枚举锁过一次);
//   不存在即抛错,绝不静默新建。
// - set_meta 只覆盖短字段(title / logline)。
// - propose_options 不改剧本(由 run.ts 转成 CUSTOM options),这里不处理。

import {
  type Act,
  type Character,
  type CharacterAttr,
  type JsonPatchOp,
  type Scene,
  type Screenplay,
  type WorldSection,
} from '@incipel/shared';
import {
  newActId,
  newCharacterAttrId,
  newCharacterId,
  newSceneId,
  newWorldSectionId,
} from './id.ts';

export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyError';
  }
}

export type ApplyResult = {
  // 应用后的剧本(原地修改并返回同一引用;调用方对单一内存对象推进)。
  state: Screenplay;
  // 该次工具调用产生的 JSON Patch;空数组表示未改剧本(如 propose_options)。
  patch: JsonPatchOp[];
};

// 在数组里按 id 找下标;找不到返回 -1。
function indexById<T extends { id: string }>(arr: T[], id: string): number {
  return arr.findIndex((x) => x.id === id);
}

function requireIndex<T extends { id: string }>(arr: T[], id: string, label: string): number {
  const i = indexById(arr, id);
  if (i < 0) {
    throw new ApplyError(`${label} id 不存在: ${id}(拒绝静默新建)`);
  }
  return i;
}

// 按全局唯一的 attrId 跨所有人物定位一条属性,返回 { ci, ai };找不到即抛(防御性二次门控)。
function requireAttr(state: Screenplay, attrId: string): { ci: number; ai: number } {
  for (let ci = 0; ci < state.characters.length; ci++) {
    const ai = indexById(state.characters[ci]!.attrs, attrId);
    if (ai >= 0) return { ci, ai };
  }
  throw new ApplyError(`character_attr id 不存在: ${attrId}(拒绝静默新建)`);
}

// 在已有对象上应用「可选字段」更新:仅覆盖显式传入(非 undefined)的字段,并生成对应 patch。
function patchFields<T extends Record<string, unknown>>(
  target: T,
  basePath: string,
  updates: Partial<T>,
): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    (target as Record<string, unknown>)[key] = value;
    ops.push({ op: 'replace', path: `${basePath}/${key}`, value });
  }
  return ops;
}

function touchUpdatedAt(state: Screenplay): JsonPatchOp {
  const now = new Date().toISOString();
  state.meta.updatedAt = now;
  return { op: 'replace', path: '/meta/updatedAt', value: now };
}

/**
 * 应用一次工具调用。args 已由 ai SDK 按对应 Zod schema 解析校验;这里只读取已知字段、
 * 做防御性二次 id 门控,并改 state、产 patch。
 *
 * @param toolName 工具名(@incipel/shared 的 ToolName)
 * @param args     该工具的参数对象(已解析)
 * @param state    当前内存剧本(将被原地修改)
 */
export function applyToolCall(toolName: string, args: unknown, state: Screenplay): ApplyResult {
  const a = (args ?? {}) as Record<string, unknown>;

  switch (toolName) {
    // ── meta ───────────────────────────────────────────────────────────────
    case 'set_meta': {
      const ops: JsonPatchOp[] = [];
      if (typeof a.title === 'string') {
        state.meta.title = a.title;
        ops.push({ op: 'replace', path: '/meta/title', value: a.title });
      }
      if (typeof a.logline === 'string') {
        state.meta.logline = a.logline;
        ops.push({ op: 'replace', path: '/meta/logline', value: a.logline });
      }
      if (ops.length) ops.push(touchUpdatedAt(state));
      return { state, patch: ops };
    }

    // ── 世界观小节 ─────────────────────────────────────────────────────────
    case 'add_world_section': {
      const section: WorldSection = {
        id: newWorldSectionId(),
        title: String(a.title ?? ''),
        text: String(a.text ?? ''),
      };
      const i = state.world.push(section) - 1;
      return {
        state,
        patch: [{ op: 'add', path: `/world/${i}`, value: section }, touchUpdatedAt(state)],
      };
    }
    case 'update_world_section': {
      const i = requireIndex(state.world, String(a.id), 'world_section');
      const ops = patchFields(state.world[i]!, `/world/${i}`, {
        title: a.title as string | undefined,
        text: a.text as string | undefined,
      });
      if (ops.length) ops.push(touchUpdatedAt(state));
      return { state, patch: ops };
    }
    case 'remove_world_section': {
      const i = requireIndex(state.world, String(a.id), 'world_section');
      state.world.splice(i, 1);
      return { state, patch: [{ op: 'remove', path: `/world/${i}` }, touchUpdatedAt(state)] };
    }

    // ── 人物 ───────────────────────────────────────────────────────────────
    case 'add_character': {
      // 新建时可一并带初始属性(attr id 一律服务端生成,模型无权自造)。
      const rawAttrs = Array.isArray(a.attrs) ? (a.attrs as Array<{ label?: unknown; value?: unknown }>) : [];
      const character: Character = {
        id: newCharacterId(),
        name: String(a.name ?? ''),
        role: String(a.role ?? ''),
        attrs: rawAttrs.map((at) => ({
          id: newCharacterAttrId(),
          label: String(at?.label ?? ''),
          value: String(at?.value ?? ''),
        })),
      };
      const i = state.characters.push(character) - 1;
      return {
        state,
        patch: [{ op: 'add', path: `/characters/${i}`, value: character }, touchUpdatedAt(state)],
      };
    }
    case 'update_character': {
      const i = requireIndex(state.characters, String(a.id), 'character');
      const ops = patchFields(state.characters[i]!, `/characters/${i}`, {
        name: a.name as string | undefined,
        role: a.role as string | undefined,
      });
      if (ops.length) ops.push(touchUpdatedAt(state));
      return { state, patch: ops };
    }
    case 'remove_character': {
      const i = requireIndex(state.characters, String(a.id), 'character');
      state.characters.splice(i, 1);
      return { state, patch: [{ op: 'remove', path: `/characters/${i}` }, touchUpdatedAt(state)] };
    }

    // ── 人物属性 ───────────────────────────────────────────────────────────
    case 'add_character_attr': {
      const ci = requireIndex(state.characters, String(a.characterId), 'character');
      const attr: CharacterAttr = {
        id: newCharacterAttrId(),
        label: String(a.label ?? ''),
        value: String(a.value ?? ''),
      };
      const ai = state.characters[ci]!.attrs.push(attr) - 1;
      return {
        state,
        patch: [
          { op: 'add', path: `/characters/${ci}/attrs/${ai}`, value: attr },
          touchUpdatedAt(state),
        ],
      };
    }
    case 'update_character_attr': {
      const { ci, ai } = requireAttr(state, String(a.attrId));
      const ops = patchFields(state.characters[ci]!.attrs[ai]!, `/characters/${ci}/attrs/${ai}`, {
        label: a.label as string | undefined,
        value: a.value as string | undefined,
      });
      if (ops.length) ops.push(touchUpdatedAt(state));
      return { state, patch: ops };
    }
    case 'remove_character_attr': {
      const { ci, ai } = requireAttr(state, String(a.attrId));
      state.characters[ci]!.attrs.splice(ai, 1);
      return {
        state,
        patch: [{ op: 'remove', path: `/characters/${ci}/attrs/${ai}` }, touchUpdatedAt(state)],
      };
    }

    // ── 幕(大纲)──────────────────────────────────────────────────────────
    case 'add_act': {
      const act: Act = {
        id: newActId(),
        act: String(a.act ?? ''),
        beat: String(a.beat ?? ''),
      };
      const i = state.outline.push(act) - 1;
      return {
        state,
        patch: [{ op: 'add', path: `/outline/${i}`, value: act }, touchUpdatedAt(state)],
      };
    }
    case 'update_act': {
      const i = requireIndex(state.outline, String(a.id), 'act');
      const ops = patchFields(state.outline[i]!, `/outline/${i}`, {
        act: a.act as string | undefined,
        beat: a.beat as string | undefined,
      });
      if (ops.length) ops.push(touchUpdatedAt(state));
      return { state, patch: ops };
    }
    case 'remove_act': {
      const i = requireIndex(state.outline, String(a.id), 'act');
      state.outline.splice(i, 1);
      return { state, patch: [{ op: 'remove', path: `/outline/${i}` }, touchUpdatedAt(state)] };
    }

    // ── 分场 ───────────────────────────────────────────────────────────────
    case 'add_scene': {
      const scene: Scene = {
        id: newSceneId(),
        slug: String(a.slug ?? ''),
        content: String(a.content ?? ''),
      };
      const i = state.scenes.push(scene) - 1;
      return {
        state,
        patch: [{ op: 'add', path: `/scenes/${i}`, value: scene }, touchUpdatedAt(state)],
      };
    }
    case 'update_scene': {
      const i = requireIndex(state.scenes, String(a.id), 'scene');
      const ops = patchFields(state.scenes[i]!, `/scenes/${i}`, {
        slug: a.slug as string | undefined,
        content: a.content as string | undefined,
      });
      if (ops.length) ops.push(touchUpdatedAt(state));
      return { state, patch: ops };
    }
    case 'remove_scene': {
      const i = requireIndex(state.scenes, String(a.id), 'scene');
      state.scenes.splice(i, 1);
      return { state, patch: [{ op: 'remove', path: `/scenes/${i}` }, touchUpdatedAt(state)] };
    }

    // ── 选项:不改剧本(由 run.ts 转 CUSTOM options)────────────────────────
    case 'propose_options':
      return { state, patch: [] };

    default:
      throw new ApplyError(`未知工具: ${toolName}`);
  }
}
