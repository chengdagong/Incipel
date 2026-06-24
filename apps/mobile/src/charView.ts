// 人物卡视图派生:从结构化 attrs 抽出身份徽标 / 年龄·性别 / 小传 / 标签(对齐原型 charVM)。
// 内联卡片(InlineCard)与文档人物详情(DocPanel)共用,保证两处呈现一致。

import type { Character, CharacterAttr } from '@incipel/shared';

// 这些属性单列(身份→徽标、年龄/性别→一行、背景→小传),不进标签 chip。
const HIDDEN = new Set(['身份', '年龄', '性别', '背景']);

export type CharView = { identity: string; ageGender: string; bio: string; tags: CharacterAttr[] };

export function charView(c: Character): CharView {
  const attr = (label: string) => c.attrs.find((a) => a.label === label)?.value ?? '';
  return {
    identity: attr('身份'),
    ageGender: [attr('年龄'), attr('性别')].filter(Boolean).join(' · '),
    bio: attr('背景'),
    tags: c.attrs.filter((a) => !HIDDEN.has(a.label)),
  };
}

// 身份徽标配色:主角(主色底白字)/ 群像(浅灰)/ 配角(浅陶土,默认)。
export function badgeBox(identity: string, accent: string): { box: object; color: string } {
  if (identity === '主角') return { box: { backgroundColor: accent }, color: '#fff' };
  if (identity === '群像') return { box: { backgroundColor: '#F1EDE6' }, color: '#8B867C' };
  return { box: { backgroundColor: '#F5ECE3', borderWidth: 1, borderColor: '#E6D3C2' }, color: '#A8643F' };
}
