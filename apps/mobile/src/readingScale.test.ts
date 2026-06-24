import { describe, it, expect } from 'vitest';
import {
  FONT_SCALES,
  LINE_SCALES,
  normalizeFontLevel,
  normalizeLineLevel,
  scaleReaderStyle,
} from './readingScale';

describe('readingScale', () => {
  it('标准档倍率为 1', () => {
    expect(FONT_SCALES.standard).toBe(1);
    expect(LINE_SCALES.standard).toBe(1);
  });

  it('各档倍率取值', () => {
    expect(FONT_SCALES).toEqual({ small: 0.9, standard: 1, large: 1.15, xlarge: 1.3 });
    expect(LINE_SCALES).toEqual({ compact: 0.92, standard: 1, loose: 1.15 });
  });

  it('未知 / 损坏值回落标准档', () => {
    expect(normalizeFontLevel('huge')).toBe('standard');
    expect(normalizeFontLevel(undefined)).toBe('standard');
    expect(normalizeFontLevel('large')).toBe('large');
    expect(normalizeLineLevel(null)).toBe('standard');
    expect(normalizeLineLevel('loose')).toBe('loose');
  });

  it('标准 / 标准:输出等于输入', () => {
    expect(scaleReaderStyle({ fontSize: 13, lineHeight: 23 }, 1, 1)).toEqual({ fontSize: 13, lineHeight: 23 });
  });

  it('字号缩放;行高随字号等比、再叠加行距', () => {
    expect(scaleReaderStyle({ fontSize: 20, lineHeight: 20 }, 1.15, 1)).toEqual({ fontSize: 23, lineHeight: 23 });
    expect(scaleReaderStyle({ fontSize: 20, lineHeight: 20 }, 1, 1.15)).toEqual({ fontSize: 20, lineHeight: 23 });
  });

  it('非整数结果保留两位小数', () => {
    // 13 ×1.15 = 14.95;23 ×1.15 ×1.15 = 30.4175 → 30.42(验证 round2 对小数结果生效)
    expect(scaleReaderStyle({ fontSize: 13, lineHeight: 23 }, 1.15, 1.15)).toEqual({ fontSize: 14.95, lineHeight: 30.42 });
  });

  it('只有 fontSize 时不凭空造 lineHeight', () => {
    expect(scaleReaderStyle({ fontSize: 10 }, 1.3, 1.15)).toEqual({ fontSize: 13 });
  });

  it('空样式返回空对象', () => {
    expect(scaleReaderStyle({}, 1.3, 1.15)).toEqual({});
  });
});
