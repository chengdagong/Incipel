import { z } from 'zod';
// 显式 .ts 扩展名保留历史 Deno 入口兼容;tsx / vitest / Metro 均可解析。
// tsc 经 base 的 allowImportingTsExtensions 放行。
import type { Screenplay } from './screenplay.ts';

// 模型↔剧本的修改契约(docs/adr/0001):
// - 新建与修改是两个显式动作:add_*(不带 id)/ update_*(必须带 id)。不用 upsert。
// - id 一律由服务端生成;update_* / remove_* 的 id 在 schema 里被约束为
//   「当前剧本中真实存在的那组 id」的枚举,每轮按当前状态重新生成 —— 这就是模型端门控。

export const TOOL_NAMES = [
  'set_meta',
  'add_world_section',
  'update_world_section',
  'remove_world_section',
  'add_character',
  'update_character',
  'remove_character',
  'add_character_attr',
  'update_character_attr',
  'remove_character_attr',
  'add_act',
  'update_act',
  'remove_act',
  'add_scene',
  'update_scene',
  'remove_scene',
  'propose_options',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

// 各实体当前存在的 id 集合,用来按轮生成 update/remove 的枚举门控。
// characterAttrs 是所有人物属性 id 的扁平集合(attrId 全局唯一),供 update/remove_character_attr 门控。
export type IdSets = {
  world: string[];
  characters: string[];
  characterAttrs: string[];
  acts: string[];
  scenes: string[];
};

export function idSetsOf(s: Screenplay): IdSets {
  return {
    world: s.world.map((x) => x.id),
    characters: s.characters.map((x) => x.id),
    characterAttrs: s.characters.flatMap((c) => c.attrs.map((a) => a.id)),
    acts: s.outline.map((x) => x.id),
    scenes: s.scenes.map((x) => x.id),
  };
}

// z.enum 需要非空元组。某类实体当前没有 id 时,直接不暴露它的 update/remove 工具
// (见 buildToolSchemas),从根上让模型无从引用不存在的 id。
function idEnum(ids: string[]) {
  return z.enum(ids as [string, ...string[]]);
}

/**
 * 按当前剧本状态构造本轮可用的工具 schema 集合。
 * add_* 与 set_meta / propose_options 恒定存在;update_* / remove_* 仅在该类实体
 * 已有 id 时出现,且其 id 被枚举锁死。
 */
export function buildToolSchemas(ids: IdSets): Record<string, z.ZodTypeAny> {
  const tools: Record<string, z.ZodTypeAny> = {
    set_meta: z.object({ title: z.string().optional(), logline: z.string().optional() }),
    add_world_section: z.object({ title: z.string(), text: z.string() }),
    // 人物:名字 + 一句话定位(role)+ 可选的初始属性 attrs。
    // 新建时一并带 attrs,是为了让「本轮新建人物 + 给它属性」能一次完成——新人物的 id 本轮还不在
    // characters 枚举里,add_character_attr 当轮无法引用它(见 ADR-0001 扩展段)。attr id 仍由服务端生成。
    // 后续对已存在人物增删改属性,走 *_character_attr。
    add_character: z.object({
      name: z.string(),
      role: z.string().optional(),
      attrs: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    }),
    add_act: z.object({ act: z.string(), beat: z.string() }),
    add_scene: z.object({ slug: z.string(), content: z.string() }),
    propose_options: z.object({ options: z.array(z.string()).max(3) }),
  };

  if (ids.world.length) {
    tools.update_world_section = z.object({
      id: idEnum(ids.world),
      title: z.string().optional(),
      text: z.string().optional(),
    });
    tools.remove_world_section = z.object({ id: idEnum(ids.world) });
  }
  if (ids.characters.length) {
    tools.update_character = z.object({
      id: idEnum(ids.characters),
      name: z.string().optional(),
      role: z.string().optional(),
    });
    tools.remove_character = z.object({ id: idEnum(ids.characters) });
    // 给某个已存在的人物加一条属性(characterId 枚举锁死到现有人物)。
    tools.add_character_attr = z.object({
      characterId: idEnum(ids.characters),
      label: z.string(),
      value: z.string(),
    });
  }
  if (ids.characterAttrs.length) {
    // attrId 全局唯一,枚举锁死到现有属性;无需再带 characterId。
    tools.update_character_attr = z.object({
      attrId: idEnum(ids.characterAttrs),
      label: z.string().optional(),
      value: z.string().optional(),
    });
    tools.remove_character_attr = z.object({ attrId: idEnum(ids.characterAttrs) });
  }
  if (ids.acts.length) {
    tools.update_act = z.object({
      id: idEnum(ids.acts),
      act: z.string().optional(),
      beat: z.string().optional(),
    });
    tools.remove_act = z.object({ id: idEnum(ids.acts) });
  }
  if (ids.scenes.length) {
    tools.update_scene = z.object({
      id: idEnum(ids.scenes),
      slug: z.string().optional(),
      content: z.string().optional(),
    });
    tools.remove_scene = z.object({ id: idEnum(ids.scenes) });
  }

  return tools;
}
