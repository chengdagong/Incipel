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

type IdSchema = z.ZodType<string>;

type AlwaysToolName =
  | 'set_meta'
  | 'add_world_section'
  | 'add_character'
  | 'add_act'
  | 'add_scene'
  | 'propose_options';
type IdToolName = Exclude<ToolName, AlwaysToolName>;

const toolSchemaBuilders = {
  set_meta: () => z.object({ title: z.string().optional(), logline: z.string().optional() }),
  add_world_section: () => z.object({ title: z.string(), text: z.string() }),
  update_world_section: (id: IdSchema) =>
    z.object({
      id,
      title: z.string().optional(),
      text: z.string().optional(),
    }),
  remove_world_section: (id: IdSchema) => z.object({ id }),
  // 人物:名字 + 一句话定位(role)+ 可选的初始属性 attrs。
  // 新建时一并带 attrs,是为了让「本轮新建人物 + 给它属性」能一次完成——新人物的 id 本轮还不在
  // characters 枚举里,add_character_attr 当轮无法引用它(见 ADR-0001 扩展段)。attr id 仍由服务端生成。
  // 后续对已存在人物增删改属性,走 *_character_attr。
  add_character: () =>
    z.object({
      name: z.string(),
      role: z.string().optional(),
      attrs: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    }),
  update_character: (id: IdSchema) =>
    z.object({
      id,
      name: z.string().optional(),
      role: z.string().optional(),
    }),
  remove_character: (id: IdSchema) => z.object({ id }),
  // 给某个已存在的人物加一条属性(characterId 枚举锁死到现有人物)。
  add_character_attr: (characterId: IdSchema) =>
    z.object({
      characterId,
      label: z.string(),
      value: z.string(),
    }),
  // attrId 全局唯一,枚举锁死到现有属性;无需再带 characterId。
  update_character_attr: (attrId: IdSchema) =>
    z.object({
      attrId,
      label: z.string().optional(),
      value: z.string().optional(),
    }),
  remove_character_attr: (attrId: IdSchema) => z.object({ attrId }),
  add_act: () => z.object({ act: z.string(), beat: z.string() }),
  update_act: (id: IdSchema) =>
    z.object({
      id,
      act: z.string().optional(),
      beat: z.string().optional(),
    }),
  remove_act: (id: IdSchema) => z.object({ id }),
  add_scene: () => z.object({ slug: z.string(), content: z.string() }),
  update_scene: (id: IdSchema) =>
    z.object({
      id,
      slug: z.string().optional(),
      content: z.string().optional(),
    }),
  remove_scene: (id: IdSchema) => z.object({ id }),
  propose_options: () => z.object({ options: z.array(z.string()).max(3) }),
} satisfies Record<AlwaysToolName, () => z.ZodTypeAny> & Record<IdToolName, (id: IdSchema) => z.ZodTypeAny>;

/**
 * 按当前剧本状态构造本轮可用的工具 schema 集合。
 * add_* 与 set_meta / propose_options 恒定存在;update_* / remove_* 仅在该类实体
 * 已有 id 时出现,且其 id 被枚举锁死。
 */
export function buildToolSchemas(ids: IdSets): Record<string, z.ZodTypeAny> {
  const tools: Record<string, z.ZodTypeAny> = {
    set_meta: toolSchemaBuilders.set_meta(),
    add_world_section: toolSchemaBuilders.add_world_section(),
    add_character: toolSchemaBuilders.add_character(),
    add_act: toolSchemaBuilders.add_act(),
    add_scene: toolSchemaBuilders.add_scene(),
    propose_options: toolSchemaBuilders.propose_options(),
  };

  if (ids.world.length) {
    tools.update_world_section = toolSchemaBuilders.update_world_section(idEnum(ids.world));
    tools.remove_world_section = toolSchemaBuilders.remove_world_section(idEnum(ids.world));
  }
  if (ids.characters.length) {
    tools.update_character = toolSchemaBuilders.update_character(idEnum(ids.characters));
    tools.remove_character = toolSchemaBuilders.remove_character(idEnum(ids.characters));
    tools.add_character_attr = toolSchemaBuilders.add_character_attr(idEnum(ids.characters));
  }
  if (ids.characterAttrs.length) {
    tools.update_character_attr = toolSchemaBuilders.update_character_attr(idEnum(ids.characterAttrs));
    tools.remove_character_attr = toolSchemaBuilders.remove_character_attr(idEnum(ids.characterAttrs));
  }
  if (ids.acts.length) {
    tools.update_act = toolSchemaBuilders.update_act(idEnum(ids.acts));
    tools.remove_act = toolSchemaBuilders.remove_act(idEnum(ids.acts));
  }
  if (ids.scenes.length) {
    tools.update_scene = toolSchemaBuilders.update_scene(idEnum(ids.scenes));
    tools.remove_scene = toolSchemaBuilders.remove_scene(idEnum(ids.scenes));
  }

  return tools;
}

export function buildStudioToolSchemas(): Record<ToolName, z.ZodTypeAny> {
  const id = z.string();
  return {
    set_meta: toolSchemaBuilders.set_meta(),
    add_world_section: toolSchemaBuilders.add_world_section(),
    update_world_section: toolSchemaBuilders.update_world_section(id),
    remove_world_section: toolSchemaBuilders.remove_world_section(id),
    add_character: toolSchemaBuilders.add_character(),
    update_character: toolSchemaBuilders.update_character(id),
    remove_character: toolSchemaBuilders.remove_character(id),
    add_character_attr: toolSchemaBuilders.add_character_attr(id),
    update_character_attr: toolSchemaBuilders.update_character_attr(id),
    remove_character_attr: toolSchemaBuilders.remove_character_attr(id),
    add_act: toolSchemaBuilders.add_act(),
    update_act: toolSchemaBuilders.update_act(id),
    remove_act: toolSchemaBuilders.remove_act(id),
    add_scene: toolSchemaBuilders.add_scene(),
    update_scene: toolSchemaBuilders.update_scene(id),
    remove_scene: toolSchemaBuilders.remove_scene(id),
    propose_options: toolSchemaBuilders.propose_options(),
  };
}
