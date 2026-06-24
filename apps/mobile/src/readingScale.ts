// 阅读区(文档 / 内联卡片)字号 / 行距缩放的纯逻辑。不引 React Native,便于单测。
// 档位 → 倍率,以及把一份文字样式按当前缩放算出新的 fontSize / lineHeight。

export type FontLevel = 'small' | 'standard' | 'large' | 'xlarge';
export type LineLevel = 'compact' | 'standard' | 'loose';

export const FONT_SCALES: Record<FontLevel, number> = {
  small: 0.9,
  standard: 1,
  large: 1.15,
  xlarge: 1.3,
};

export const LINE_SCALES: Record<LineLevel, number> = {
  compact: 0.92,
  standard: 1,
  loose: 1.15,
};

// 读到未知 / 损坏的存储值时回落标准档。
export function normalizeFontLevel(v: unknown): FontLevel {
  return v === 'small' || v === 'large' || v === 'xlarge' ? v : 'standard';
}
export function normalizeLineLevel(v: unknown): LineLevel {
  return v === 'compact' || v === 'loose' ? v : 'standard';
}

export type ScalableText = { fontSize?: number; lineHeight?: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

// 行高先随字号等比(× fontScale)、再叠加行距档(× lineScale);缺哪个字段就不返回哪个。
export function scaleReaderStyle(style: ScalableText, fontScale: number, lineScale: number): ScalableText {
  const out: ScalableText = {};
  if (typeof style.fontSize === 'number') out.fontSize = round2(style.fontSize * fontScale);
  if (typeof style.lineHeight === 'number') out.lineHeight = round2(style.lineHeight * fontScale * lineScale);
  return out;
}
