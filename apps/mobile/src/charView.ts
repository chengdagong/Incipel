// 人物卡视图派生:从结构化 attrs 抽出身份徽标 / 年龄·性别 / 小传 / 标签(对齐原型 charVM)。
// 内联卡片(InlineCard)与文档人物详情(DocPanel)共用,保证两处呈现一致。

import type { Character, CharacterAttr } from '@incipel/shared';

// 这些标签各有专属呈现位(年龄/性别→一行、背景→小传),不进标签 chip。
// 「身份」单独判断(见下):标准值→徽标、非标准值视情况充当小传或退为普通标签。
const HIDDEN = new Set(['年龄', '性别', '背景']);

// 身份徽标只接受这三种标准类别(对齐原型 idMap)。助手自由命名属性,常把整段人物小传
// 写进「身份」(字面就是「这人是谁」);这类描述性长文不是徽标,会把 header 徽标位撑成
// 一块巨型方框——应归入小传(正文),绝不进 header。
const IDENTITY_BADGES = new Set(['主角', '配角', '群像']);

export type CharView = { identity: string; ageGender: string; bio: string; tags: CharacterAttr[] };

export function charView(c: Character): CharView {
  const attr = (label: string) => c.attrs.find((a) => a.label === label)?.value ?? '';
  const rawIdentity = attr('身份').trim();
  const isBadge = IDENTITY_BADGES.has(rawIdentity);
  const background = attr('背景');
  // 非标准「身份」(如「反派」或被误塞的整段小传):没有「背景」时充当小传;
  // 有「背景」时不丢弃——退为普通标签照常显示(否则该值会在界面上彻底消失)。
  const identityAsBio = !isBadge && !!rawIdentity && !background;
  return {
    // 仅标准类别作徽标;非标准的「身份」值不渲染徽标(渲染处回退到「人物」eyebrow)。
    identity: isBadge ? rawIdentity : '',
    ageGender: [attr('年龄'), attr('性别')].filter(Boolean).join(' · '),
    // 小传优先取「背景」;若无,则把被误塞进「身份」的描述性长文当作小传,放进正文。
    bio: background || (identityAsBio ? rawIdentity : ''),
    // 「身份」仅在已被用作徽标或小传时从标签里隐藏;否则保留为标签,避免已存值消失。
    tags: c.attrs.filter((a) => {
      if (HIDDEN.has(a.label)) return false;
      if (a.label === '身份') return !(isBadge || identityAsBio);
      return true;
    }),
  };
}

// 身份徽标配色:主角(主色底白字)/ 群像(浅灰)/ 配角(浅陶土,默认)。
export function badgeBox(identity: string, accent: string): { box: object; color: string } {
  if (identity === '主角') return { box: { backgroundColor: accent }, color: '#fff' };
  if (identity === '群像') return { box: { backgroundColor: '#F1EDE6' }, color: '#8B867C' };
  return { box: { backgroundColor: '#F5ECE3', borderWidth: 1, borderColor: '#E6D3C2' }, color: '#A8643F' };
}
