// 恢复已有会话时,还原「最近一轮新增」内联卡片所需的对比基线(纯函数,便于单测)。
//
// 实时对话里,每条助手消息下方的内联卡片 = 该轮相对上一版剧本的新增实体(见 chat.tsx 的 diffCard);
// 且任一时刻只有最新一条助手消息挂卡片。重新打开会话时,要让最后一条助手消息照样显示它那一轮的
// 新增,就需要「该轮发生前的剧本」作对比基线。
//
// 这里用最后一条助手消息的 JSON Patch deltas 反推:把这一轮 add 进来的顶层实体(world/characters/
// outline/scenes,按 id)从当前剧本里去掉,即得发生前的基线。diffCard(基线, 当前剧本) 便还原出
// 这一轮的新增。语义与 diffCard 一致:只认按顶层 id 全新的实体——给既有人物追加 attrs 不算(attr 的 id
// 不是任何顶层实体的 id,filter 时不会命中,人物仍留在基线里)。

import type { Screenplay } from '@incipel/shared';

// 从 deltas 收集 add 操作新增对象的 id(world/character/outline/scene 实体的 value 都带 id)。
function collectAddedIds(deltas: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(deltas)) return ids;
  for (const op of deltas) {
    if (op && typeof op === 'object' && (op as { op?: unknown }).op === 'add') {
      const value = (op as { value?: unknown }).value;
      if (value && typeof value === 'object') {
        const id = (value as { id?: unknown }).id;
        if (typeof id === 'string') ids.add(id);
      }
    }
  }
  return ids;
}

// 给定当前(恢复出的)剧本与「最近一轮」的 deltas,反推该轮发生前的剧本基线。
// 无新增(deltas 为空 / 非数组 / 只改了既有实体)时,基线即当前剧本,diffCard 得空卡片。
export function baselineBeforeLastTurn(state: Screenplay, lastTurnDeltas: unknown): Screenplay {
  const added = collectAddedIds(lastTurnDeltas);
  if (added.size === 0) return state;
  return {
    ...state,
    world: state.world.filter((w) => !added.has(w.id)),
    characters: state.characters.filter((c) => !added.has(c.id)),
    outline: state.outline.filter((o) => !added.has(o.id)),
    scenes: state.scenes.filter((s) => !added.has(s.id)),
  };
}
