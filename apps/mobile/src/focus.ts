// 聚焦标签(focus chip):把某个人物或其某条属性带入输入框作为聚焦上下文(见 issue #12)。
// 对齐原型「编剧助手 原型.dc.html」的 contextChips / discussAttr / discussCharacter / sendComposer。
//
// chip 是一轮内的瞬时 UI 状态(不入剧本);发送时把各 chip 的 detail 拼成「（聚焦：…）」前缀,
// 并入这条用户消息发给 agent —— agent 端无需特殊处理,它就是普通用户消息文本。
//
// 文案随界面语言切换(传入 t):agent 的回复语言跟随用户本轮输入(见 prompt.ts 语气段),
// 若这里始终拼中文,非中文用户发出的聚焦消息就会把回复带成中文,与设置页承诺相悖。

import type { Character, CharacterAttr } from '@incipel/shared';
import type { TKey } from './i18n';

// 与 i18n 的 t 同签名;聚焦文案经它本地化(键见 i18n.tsx 的 focus* 系列)。
type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export type FocusChip = {
  key: string; // 去重用(同一属性/人物只挂一枚)
  kind: string; // 弱化显示的类别(属性名,或本地化的「人物」)
  tag: string; // 主显示(人物名)
  detail: string; // 发送时并入消息的聚焦描述(已本地化)
};

const named = (c: Character, t: Translate): string => c.name || t('focusUnnamed');

// 点某条人物属性 → 聚焦该属性。key 用稳定 id(模型已扩展为结构化属性)。
export function chipFromAttr(c: Character, a: CharacterAttr, t: Translate): FocusChip {
  const name = named(c, t);
  return {
    key: `attr:${c.id}:${a.id}`,
    kind: a.label, // 属性名属剧本内容(随剧本语言),不翻译
    tag: name,
    detail: t('focusAttrDetail', { name, label: a.label, value: a.value }),
  };
}

// 点人物卡「聊聊 TA」→ 聚焦整个人物。
export function chipFromCharacter(c: Character, t: Translate): FocusChip {
  const name = named(c, t);
  return { key: `char:${c.id}`, kind: t('focusKindChar'), tag: name, detail: t('focusCharDetail', { name }) };
}

// 把正文 + 聚焦 chip 拼成最终发出的消息(原型 sendComposer 的逻辑),整段随界面语言本地化。
export function composeFocusMessage(text: string, chips: FocusChip[], t: Translate): string {
  const trimmed = text.trim();
  if (!chips.length) return trimmed;
  const ctx = t('focusWrap', { ctx: chips.map((c) => c.detail).join(t('focusJoin')) });
  return trimmed ? `${ctx} ${trimmed}` : `${ctx} ${t('focusFallback')}`;
}
