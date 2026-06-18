// 服务端生成稳定 id。模型无权自造 id(见 docs/adr/0001):
// add_* 工具落库时由这里生成,update_* / remove_* 只能引用已存在的 id。
//
// 形如 <prefix>_<nanoid>,前缀按实体类型区分,便于日志与调试时一眼辨认归属。

import { nanoid } from 'nanoid';

export type EntityKind = 'char' | 'charAttr' | 'world' | 'act' | 'scene';

const PREFIX: Record<EntityKind, string> = {
  char: 'char_',
  charAttr: 'cattr_',
  world: 'world_',
  act: 'act_',
  scene: 'scene_',
};

// nanoid 默认 21 字符;这里用 12 字符,在单会话实体数量级下碰撞概率可忽略,且 id 更短。
const ID_LENGTH = 12;

export function newId(kind: EntityKind): string {
  return `${PREFIX[kind]}${nanoid(ID_LENGTH)}`;
}

export const newWorldSectionId = (): string => newId('world');
export const newCharacterId = (): string => newId('char');
export const newCharacterAttrId = (): string => newId('charAttr');
export const newActId = (): string => newId('act');
export const newSceneId = (): string => newId('scene');
