// 聚焦标签(focus chip):把某个人物或其某条属性带入输入框作为聚焦上下文(见 issue #12)。
// 对齐原型「编剧助手 原型.dc.html」的 contextChips / discussAttr / discussCharacter / sendComposer。
//
// chip 是一轮内的瞬时 UI 状态(不入剧本);发送时把各 chip 的 detail 拼成「（聚焦：…）」前缀,
// 并入这条用户消息发给 agent —— agent 端无需特殊处理,它就是普通用户消息文本。

import type { Character, CharacterAttr } from '@incipel/shared';

export type FocusChip = {
  key: string; // 去重用(同一属性/人物只挂一枚)
  kind: string; // 弱化显示的类别(属性名,或「人物」)
  tag: string; // 主显示(人物名)
  detail: string; // 发送时并入消息的聚焦描述
};

const named = (c: Character): string => c.name || '角色';

// 点某条人物属性 → 聚焦该属性。key 用稳定 id(模型已扩展为结构化属性)。
export function chipFromAttr(c: Character, a: CharacterAttr): FocusChip {
  return {
    key: `attr:${c.id}:${a.id}`,
    kind: a.label,
    tag: named(c),
    detail: `「${named(c)}」的${a.label}（当前为：${a.value}）`,
  };
}

// 点人物卡「聊聊 TA」→ 聚焦整个人物。
export function chipFromCharacter(c: Character): FocusChip {
  return { key: `char:${c.id}`, kind: '人物', tag: named(c), detail: `人物「${named(c)}」` };
}

// 把正文 + 聚焦 chip 拼成最终发出的消息(原型 sendComposer 的逻辑)。
export function composeFocusMessage(text: string, chips: FocusChip[]): string {
  const t = text.trim();
  if (!chips.length) return t;
  const ctx = `（聚焦：${chips.map((c) => c.detail).join('；')}）`;
  return t ? `${ctx} ${t}` : `${ctx} 帮我打磨这部分设定，先给我几个不同方向。`;
}
