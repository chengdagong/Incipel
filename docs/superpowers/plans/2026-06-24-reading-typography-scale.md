# 阅读区字号 / 行距可调 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页加两组分档按钮(字号 4 档、行距 3 档),即时缩放文档面板与对话内联卡片里的剧本文字,本机持久化。

**Architecture:** 新增一个持久化偏好 context(`ReadingPrefsProvider`,照搬 i18n 写法),一个纯缩放模块(`readingScale.ts`),一个包装组件(`ReaderText`)。在 `DocPanel` / `InlineCard` 里把**剧本内容**的 `Text` 换成 `ReaderText`,由它按当前档位乘字号与行高。界面 chrome 不动。

**Tech Stack:** React Native(Expo)、TypeScript、`@react-native-async-storage/async-storage`、Vitest。

## Global Constraints

- 设计文档:`docs/superpowers/specs/2026-06-24-reading-typography-scale-design.md`(本计划逐条覆盖之)。
- 本机 `pnpm` 在 `/Users/chengdagong/.hermes/node/bin/pnpm`,**不在 PATH**;下文命令里的 `pnpm` 按此全路径替换。所有 `pnpm` 命令在 `apps/mobile/` 目录下运行。
- 默认档位 = `standard / standard`,倍率 `1.0 / 1.0`,**未调过的安装视觉零变化**。
- 字号倍率:`小 0.9 / 标准 1.0 / 大 1.15 / 特大 1.3`。行距倍率:`紧凑 0.92 / 标准 1.0 / 宽松 1.15`。
- 缩放公式:`fontSize = base × fontScale`;`lineHeight = base × fontScale × lineScale`;结果保留两位小数。
- 作用范围仅剧本内容(`DocPanel` + `InlineCard` 的内容文字);chrome(导航、眉标、页脚、目录、徽标、设置页自身)不缩放。
- 中文文案遵守平实表达:不用行话黑话(根因 / 对齐 / 收敛 / 落地 / 闭环 / 兜底 / 全绿 等)。
- AsyncStorage 键:`scn_read_font_v1`、`scn_read_line_v1`(沿用 `scn_<域>_v1`)。
- 每个任务结束跑 `pnpm exec tsc --noEmit` 必须无报错再提交。

---

### Task 1: 纯缩放模块 `readingScale.ts`

**Files:**
- Create: `apps/mobile/src/readingScale.ts`
- Test: `apps/mobile/src/readingScale.test.ts`

**Interfaces:**
- Produces:
  - `type FontLevel = 'small' | 'standard' | 'large' | 'xlarge'`
  - `type LineLevel = 'compact' | 'standard' | 'loose'`
  - `type ScalableText = { fontSize?: number; lineHeight?: number }`
  - `const FONT_SCALES: Record<FontLevel, number>`、`const LINE_SCALES: Record<LineLevel, number>`
  - `function normalizeFontLevel(v: unknown): FontLevel`、`function normalizeLineLevel(v: unknown): LineLevel`
  - `function scaleReaderStyle(style: ScalableText, fontScale: number, lineScale: number): ScalableText`

- [ ] **Step 1: 写失败测试**

Create `apps/mobile/src/readingScale.test.ts`:

```ts
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

  it('只有 fontSize 时不凭空造 lineHeight', () => {
    expect(scaleReaderStyle({ fontSize: 10 }, 1.3, 1.15)).toEqual({ fontSize: 13 });
  });

  it('空样式返回空对象', () => {
    expect(scaleReaderStyle({}, 1.3, 1.15)).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/readingScale.test.ts`
Expected: FAIL —— `Failed to resolve import "./readingScale"`(模块还不存在)。

- [ ] **Step 3: 写实现**

Create `apps/mobile/src/readingScale.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/readingScale.test.ts`
Expected: PASS(7 个用例全部通过)。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/readingScale.ts apps/mobile/src/readingScale.test.ts
git commit -m "feat(mobile): 阅读区字号 / 行距缩放纯逻辑 readingScale

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 偏好 provider `readingPrefs.tsx` + 挂载

**Files:**
- Create: `apps/mobile/src/readingPrefs.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes(Task 1):`FONT_SCALES`、`LINE_SCALES`、`normalizeFontLevel`、`normalizeLineLevel`、`FontLevel`、`LineLevel`。
- Produces:
  - `function ReadingPrefsProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `function useReadingPrefs(): ReadingPrefs`,其中
    `type ReadingPrefs = { fontLevel: FontLevel; lineLevel: LineLevel; setFontLevel: (l: FontLevel) => void; setLineLevel: (l: LineLevel) => void; fontScale: number; lineScale: number }`

- [ ] **Step 1: 写 provider**

Create `apps/mobile/src/readingPrefs.tsx`:

```tsx
// 阅读区字号 / 行距偏好。照搬 i18n 的 provider 写法:启动读 AsyncStorage、改动写回。
// 仅作用于剧本内容(经 ReaderText);键 scn_read_font_v1 / scn_read_line_v1,默认标准档。

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FONT_SCALES,
  LINE_SCALES,
  normalizeFontLevel,
  normalizeLineLevel,
  type FontLevel,
  type LineLevel,
} from './readingScale';

const FONT_KEY = 'scn_read_font_v1';
const LINE_KEY = 'scn_read_line_v1';

export type ReadingPrefs = {
  fontLevel: FontLevel;
  lineLevel: LineLevel;
  setFontLevel: (l: FontLevel) => void;
  setLineLevel: (l: LineLevel) => void;
  fontScale: number;
  lineScale: number;
};

const ReadingPrefsContext = createContext<ReadingPrefs | null>(null);

export function ReadingPrefsProvider({ children }: { children: React.ReactNode }) {
  const [fontLevel, setFontLevelState] = useState<FontLevel>('standard');
  const [lineLevel, setLineLevelState] = useState<LineLevel>('standard');

  // 启动时读回上次选择(默认标准档);读取失败不阻塞。
  useEffect(() => {
    let mounted = true;
    Promise.all([AsyncStorage.getItem(FONT_KEY), AsyncStorage.getItem(LINE_KEY)])
      .then(([f, l]) => {
        if (!mounted) return;
        if (f != null) setFontLevelState(normalizeFontLevel(f));
        if (l != null) setLineLevelState(normalizeLineLevel(l));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const setFontLevel = useCallback((l: FontLevel) => {
    setFontLevelState(l);
    void AsyncStorage.setItem(FONT_KEY, l).catch(() => {});
  }, []);
  const setLineLevel = useCallback((l: LineLevel) => {
    setLineLevelState(l);
    void AsyncStorage.setItem(LINE_KEY, l).catch(() => {});
  }, []);

  const api = useMemo<ReadingPrefs>(
    () => ({
      fontLevel,
      lineLevel,
      setFontLevel,
      setLineLevel,
      fontScale: FONT_SCALES[fontLevel],
      lineScale: LINE_SCALES[lineLevel],
    }),
    [fontLevel, lineLevel, setFontLevel, setLineLevel],
  );
  return <ReadingPrefsContext.Provider value={api}>{children}</ReadingPrefsContext.Provider>;
}

export function useReadingPrefs(): ReadingPrefs {
  const ctx = useContext(ReadingPrefsContext);
  if (!ctx) throw new Error('useReadingPrefs 必须在 ReadingPrefsProvider 内使用');
  return ctx;
}
```

- [ ] **Step 2: 在根布局挂载 provider**

In `apps/mobile/app/_layout.tsx`, add the import after line 14 (`import { I18nProvider } from '../src/i18n';`):

```tsx
import { ReadingPrefsProvider } from '../src/readingPrefs';
```

Then replace the return in `RootNavigator` (current single line):

```tsx
  return <I18nProvider>{ready ? <AppShell /> : <Preparing />}</I18nProvider>;
```

with:

```tsx
  return (
    <I18nProvider>
      <ReadingPrefsProvider>{ready ? <AppShell /> : <Preparing />}</ReadingPrefsProvider>
    </I18nProvider>
  );
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: 提交**

```bash
git add apps/mobile/src/readingPrefs.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): 阅读偏好 provider + 根布局挂载

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 包装组件 `ReaderText.tsx`

**Files:**
- Create: `apps/mobile/src/components/ReaderText.tsx`

**Interfaces:**
- Consumes(Task 1、2):`scaleReaderStyle`、`useReadingPrefs`。
- Produces:`function ReaderText(props: TextProps): JSX.Element`(原生 `Text` 的替代,接口与 `Text` 一致)。

- [ ] **Step 1: 写组件**

Create `apps/mobile/src/components/ReaderText.tsx`:

```tsx
// 剧本内容文字:在样式自带的 fontSize / lineHeight 基础上,按用户档位缩放。
// 仅用于阅读表面(DocPanel / InlineCard);接口与 RN Text 一致,可直接替换。
// maxFontSizeMultiplier 给系统无障碍字体缩放封顶,避免「系统最大 + app 特大」撑破版面。

import { StyleSheet, Text, type TextProps } from 'react-native';
import { scaleReaderStyle } from '../readingScale';
import { useReadingPrefs } from '../readingPrefs';

export function ReaderText({ style, maxFontSizeMultiplier = 1.6, ...rest }: TextProps) {
  const { fontScale, lineScale } = useReadingPrefs();
  const flat = StyleSheet.flatten(style) ?? {};
  const scaled = scaleReaderStyle(flat, fontScale, lineScale);
  return <Text {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[flat, scaled]} />;
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add apps/mobile/src/components/ReaderText.tsx
git commit -m "feat(mobile): ReaderText 包装组件,按档位缩放剧本文字

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: i18n 文案 `READING_I18N`

**Files:**
- Modify: `apps/mobile/src/i18n.tsx`(在 `DOC_I18N` 映射之后、`const LANG_STORAGE_KEY` 之前新增一段;约第 83 行后)

**Interfaces:**
- Produces:`export const READING_I18N: Record<Lang, ReadingStrings>`,字段见下。设置页用 `READING_I18N[lang]` 读。
- 不动「生成块」`DICT`(其注释要求勿手改)。

- [ ] **Step 1: 新增映射**

In `apps/mobile/src/i18n.tsx`, insert immediately after the `DOC_I18N` map closes (the block defining `cover / contents / tocNums / bioLabel`) and before `const LANG_STORAGE_KEY = 'scn_lang_v1';`:

```tsx
// 设置页「阅读」节文案(字号 / 行距分档 + 预览)。与 VOL_I18N / DOC_I18N 同为独立映射,
// 不进生成块 DICT;设置页按当前 lang 直接读 READING_I18N[lang]。
type ReadingStrings = {
  section: string;
  fontSize: string;
  lineSpacing: string;
  fontSmall: string;
  fontStandard: string;
  fontLarge: string;
  fontXLarge: string;
  lineCompact: string;
  lineStandard: string;
  lineLoose: string;
  desc: string;
  previewLabel: string;
  sampleAct: string;
  sampleBeat: string;
};
export const READING_I18N: Record<Lang, ReadingStrings> = {
  zh: {
    section: '阅读',
    fontSize: '字号',
    lineSpacing: '行距',
    fontSmall: '小',
    fontStandard: '标准',
    fontLarge: '大',
    fontXLarge: '特大',
    lineCompact: '紧凑',
    lineStandard: '标准',
    lineLoose: '宽松',
    desc: '只影响剧本内容(文档与对话里的卡片),不改界面其它文字。',
    previewLabel: '预览',
    sampleAct: '第二幕:充值与共振',
    sampleBeat: '林岑第一次不是出于玩笑,而是出于真切的心疼而充值。',
  },
  en: {
    section: 'Reading',
    fontSize: 'Font size',
    lineSpacing: 'Line spacing',
    fontSmall: 'Small',
    fontStandard: 'Default',
    fontLarge: 'Large',
    fontXLarge: 'XL',
    lineCompact: 'Compact',
    lineStandard: 'Default',
    lineLoose: 'Loose',
    desc: 'Affects screenplay content only (the document and inline cards), not the rest of the interface.',
    previewLabel: 'Preview',
    sampleAct: 'Act II: Top-Ups and Resonance',
    sampleBeat: 'For the first time, Lin Cen tops up not as a joke, but out of genuine compassion.',
  },
  ja: {
    section: '読みやすさ',
    fontSize: '文字サイズ',
    lineSpacing: '行間',
    fontSmall: '小',
    fontStandard: '標準',
    fontLarge: '大',
    fontXLarge: '特大',
    lineCompact: '狭い',
    lineStandard: '標準',
    lineLoose: '広い',
    desc: '脚本本文(ドキュメントと会話内のカード)のみに適用され、その他の画面表示は変わりません。',
    previewLabel: 'プレビュー',
    sampleAct: '第二幕:課金と共鳴',
    sampleBeat: 'リン・ツェンは初めて、冗談ではなく心からの思いやりで課金する。',
  },
  zhHant: {
    section: '閱讀',
    fontSize: '字體大小',
    lineSpacing: '行距',
    fontSmall: '小',
    fontStandard: '標準',
    fontLarge: '大',
    fontXLarge: '特大',
    lineCompact: '緊湊',
    lineStandard: '標準',
    lineLoose: '寬鬆',
    desc: '只影響劇本內容(文件與對話中的卡片),不改介面其它文字。',
    previewLabel: '預覽',
    sampleAct: '第二幕:儲值與共振',
    sampleBeat: '林岑第一次不是出於玩笑,而是出於真切的心疼而儲值。',
  },
};
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add apps/mobile/src/i18n.tsx
git commit -m "feat(mobile): 设置页阅读节文案 READING_I18N(四语言)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 设置页「阅读」节 + 分档控件 + 预览

**Files:**
- Modify: `apps/mobile/app/(app)/settings.tsx`

**Interfaces:**
- Consumes(Task 2、3、4):`useReadingPrefs`、`ReaderText`、`READING_I18N`、`FontLevel`、`LineLevel`。

- [ ] **Step 1: 加 import**

In `apps/mobile/app/(app)/settings.tsx`:

将 `import { LANGS, useI18n } from '../../src/i18n';` 改为:

```tsx
import { LANGS, READING_I18N, useI18n } from '../../src/i18n';
```

在 `import { defaultTheme, palette } from '../../src/theme';` 之后新增:

```tsx
import { useReadingPrefs } from '../../src/readingPrefs';
import { ReaderText } from '../../src/components/ReaderText';
import type { FontLevel, LineLevel } from '../../src/readingScale';
```

- [ ] **Step 2: 取偏好与文案**

在 `SettingsScreen` 组件内,把 `const { accent } = defaultTheme;` 改为:

```tsx
  const { accent, accentSoft, accentSoftBorder } = defaultTheme;
```

在其下新增:

```tsx
  const reading = READING_I18N[lang];
  const { fontLevel, lineLevel, setFontLevel, setLineLevel } = useReadingPrefs();
  const fontOptions: { value: FontLevel; label: string }[] = [
    { value: 'small', label: reading.fontSmall },
    { value: 'standard', label: reading.fontStandard },
    { value: 'large', label: reading.fontLarge },
    { value: 'xlarge', label: reading.fontXLarge },
  ];
  const lineOptions: { value: LineLevel; label: string }[] = [
    { value: 'compact', label: reading.lineCompact },
    { value: 'standard', label: reading.lineStandard },
    { value: 'loose', label: reading.lineLoose },
  ];
```

- [ ] **Step 3: 插入「阅读」节 JSX**

在 `langDesc` 那行之后(`<Text style={styles.langDesc}>{t('langDesc')}</Text>`)、登出块(`{isSignedIn && (`)之前,插入:

```tsx
        {/* 阅读:剧本内容字号 / 行距(仅作用于文档与内联卡片) */}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{reading.section}</Text>
        <View style={styles.card}>
          <View style={styles.readingRow}>
            <Text style={styles.readingLabel}>{reading.fontSize}</Text>
            <Segmented
              options={fontOptions}
              value={fontLevel}
              onChange={setFontLevel}
              accent={accent}
              accentSoft={accentSoft}
              accentSoftBorder={accentSoftBorder}
            />
          </View>
          <View style={styles.readingDivider} />
          <View style={styles.readingRow}>
            <Text style={styles.readingLabel}>{reading.lineSpacing}</Text>
            <Segmented
              options={lineOptions}
              value={lineLevel}
              onChange={setLineLevel}
              accent={accent}
              accentSoft={accentSoft}
              accentSoftBorder={accentSoftBorder}
            />
          </View>
        </View>
        <Text style={styles.langDesc}>{reading.desc}</Text>
        <View style={styles.previewCard}>
          <Text style={[styles.previewEyebrow, { color: accent }]}>{reading.previewLabel}</Text>
          <ReaderText style={[styles.previewAct, { color: palette.textPrimary }]}>{reading.sampleAct}</ReaderText>
          <ReaderText style={[styles.previewBeat, { color: palette.textBody }]}>{reading.sampleBeat}</ReaderText>
        </View>
```

- [ ] **Step 4: 加 `Segmented` 组件**

在文件底部 `function Globe()` 之前,新增一个泛型分档控件:

```tsx
// 分档按钮:一排等宽药丸,选中=暖色浅底 + 主色字(沿用语言项的选中观感)。
function Segmented<T extends string>({
  options,
  value,
  onChange,
  accent,
  accentSoft,
  accentSoftBorder,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent: string;
  accentSoft: string;
  accentSoftBorder: string;
}) {
  return (
    <View style={styles.segRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              styles.segPill,
              on
                ? { backgroundColor: accentSoft, borderColor: accentSoftBorder }
                : { backgroundColor: '#fff', borderColor: palette.borderChip },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`reading-seg-${o.value}`}
          >
            <Text style={[styles.segText, { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 5: 加样式**

在 `settings.tsx` 末尾的 `StyleSheet.create({ ... })` 里,`langDesc` 之后新增:

```tsx
  readingRow: { paddingVertical: 14, paddingHorizontal: 16 },
  readingLabel: { fontSize: 15, color: S.rowText, marginBottom: 10 },
  readingDivider: { height: 1, backgroundColor: S.dropDivider },
  segRow: { flexDirection: 'row', gap: 6 },
  segPill: { flex: 1, paddingVertical: 8, borderWidth: 1, borderRadius: 10, alignItems: 'center' },
  segText: { fontSize: 13 },
  previewCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: S.cardBorder,
    borderRadius: 14,
    backgroundColor: palette.cardAlt,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  previewEyebrow: { fontSize: 11, letterSpacing: 1, fontWeight: '600', marginBottom: 9 },
  previewAct: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14.5, fontWeight: '600', lineHeight: 22, marginBottom: 7 },
  previewBeat: { fontSize: 13, lineHeight: 23 },
```

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 7: 提交**

```bash
git add "apps/mobile/app/(app)/settings.tsx"
git commit -m "feat(mobile): 设置页新增阅读节,字号 / 行距分档 + 实时预览

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `InlineCard` 内容文字改用 `ReaderText`

**Files:**
- Modify: `apps/mobile/src/components/InlineCard.tsx`

**Interfaces:**
- Consumes(Task 3):`ReaderText`。

**规则:** 只把**剧本内容**文字的 `Text`(开 + 闭标签)换成 `ReaderText`;眉标 `secLabel`、页脚 `footerLabel`、身份徽标 `badgeText`、`noIdentity` 保持 `Text`。

- [ ] **Step 1: 加 import**

将 `import { Pressable, StyleSheet, Text, View } from 'react-native';` 保持不变(仍需 `Text` 给 chrome 用),在其后新增:

```tsx
import { ReaderText } from './ReaderText';
```

- [ ] **Step 2: 换世界观正文(`bodyPara`)**

把(`data.world.map` 内)这段:

```tsx
            <Text key={w.id} style={[styles.bodyPara, { color: palette.textBody }]}>
              {w.title ? `${w.title} — ${w.text}` : w.text}
            </Text>
```

改为:

```tsx
            <ReaderText key={w.id} style={[styles.bodyPara, { color: palette.textBody }]}>
              {w.title ? `${w.title} — ${w.text}` : w.text}
            </ReaderText>
```

- [ ] **Step 3: 换大纲幕名 + 节拍(`outlineAct` / `outlineBeat`)**

把(`data.outline.map` 内)这段:

```tsx
              <Text style={[styles.outlineAct, { color: palette.textPrimary }]}>{a.act}</Text>
              {splitBeat(a.beat).map((para, j) => (
                <Text key={j} style={[styles.outlineBeat, { color: palette.textBody }, j > 0 && styles.outlineBeatGap]}>
                  {para}
                </Text>
              ))}
```

改为:

```tsx
              <ReaderText style={[styles.outlineAct, { color: palette.textPrimary }]}>{a.act}</ReaderText>
              {splitBeat(a.beat).map((para, j) => (
                <ReaderText key={j} style={[styles.outlineBeat, { color: palette.textBody }, j > 0 && styles.outlineBeatGap]}>
                  {para}
                </ReaderText>
              ))}
```

- [ ] **Step 4: 换分场 slug + 正文(`sceneSlug` / `sceneContent`)**

把(`data.scenes.map` 内)这两行:

```tsx
              <Text style={[styles.sceneSlug, { color: palette.textSecondary }]}>{s.slug}</Text>
              <Text style={[styles.sceneContent, { color: palette.textBody }]}>{s.content}</Text>
```

改为:

```tsx
              <ReaderText style={[styles.sceneSlug, { color: palette.textSecondary }]}>{s.slug}</ReaderText>
              <ReaderText style={[styles.sceneContent, { color: palette.textBody }]}>{s.content}</ReaderText>
```

- [ ] **Step 5: 换人物卡内容(`charName` / `charRole` / `charAge` / `bio` / `tagText`)**

`CharacterCard` 内,逐处替换(开 + 闭标签):

`charName`:

```tsx
          <Text style={[styles.charName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</Text>
```
→
```tsx
          <ReaderText style={[styles.charName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</ReaderText>
```

`charRole`:

```tsx
          {!!c.role && <Text style={[styles.charRole, { color: palette.textSecondary }]}>{c.role}</Text>}
```
→
```tsx
          {!!c.role && <ReaderText style={[styles.charRole, { color: palette.textSecondary }]}>{c.role}</ReaderText>}
```

`charAge`:

```tsx
          {!!ageGender && <Text style={[styles.charAge, { color: palette.textSecondary }]}>{ageGender}</Text>}
```
→
```tsx
          {!!ageGender && <ReaderText style={[styles.charAge, { color: palette.textSecondary }]}>{ageGender}</ReaderText>}
```

`bio`:

```tsx
        {!!bio && <Text style={[styles.bio, { color: palette.textPrimaryAlt }]}>{bio}</Text>}
```
→
```tsx
        {!!bio && <ReaderText style={[styles.bio, { color: palette.textPrimaryAlt }]}>{bio}</ReaderText>}
```

`tagText`(标签 `Pressable` 内):

```tsx
                <Text style={[styles.tagText, { color: palette.textSecondary }]}>{tg.label}</Text>
```
→
```tsx
                <ReaderText style={[styles.tagText, { color: palette.textSecondary }]}>{tg.label}</ReaderText>
```

> 不要改 `badgeText`、`noIdentity`、`secLabel`、`footerLabel`(它们是 chrome,保留 `Text`)。

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 7: 提交**

```bash
git add apps/mobile/src/components/InlineCard.tsx
git commit -m "feat(mobile): 内联卡片剧本文字改用 ReaderText,随档位缩放

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `DocPanel` 内容文字改用 `ReaderText`

**Files:**
- Modify: `apps/mobile/src/components/DocPanel.tsx`

**Interfaces:**
- Consumes(Task 3):`ReaderText`。

**规则:** 只把剧本内容文字换成 `ReaderText`。**保留 `Text`** 的 chrome:`coverEyebrow`、`coverTitle`、`tocLabel`、`tocNum`、`tocTitle`、`tocCount`、`exportText`、`liveNoteText`、`badgeText`、`noIdentity`、`bioLabel`、`attrPanelLabel`、`attrPanelEmpty`、`sceneMark`、`chevron`、`empty`、顶栏 / 导航,以及封面占位 `coverPending`。

- [ ] **Step 1: 加 import**

在 `import { PortraitThumb } from './PortraitThumb';` 之后新增:

```tsx
import { ReaderText } from './ReaderText';
```

- [ ] **Step 2: 封面 logline(`coverLogline`)**

```tsx
          <Text style={[styles.coverLogline, { color: palette.textSecondary }]}>{logline}</Text>
```
→
```tsx
          <ReaderText style={[styles.coverLogline, { color: palette.textSecondary }]}>{logline}</ReaderText>
```

- [ ] **Step 3: 世界观(`facetLabel` / `facetBody`)**

```tsx
                        <Text style={[styles.facetLabel, { color: palette.textPrimary }]}>{w.title}</Text>
```
→
```tsx
                        <ReaderText style={[styles.facetLabel, { color: palette.textPrimary }]}>{w.title}</ReaderText>
```

```tsx
                    <Text style={[styles.facetBody, { color: palette.textBody }]}>{w.text}</Text>
```
→
```tsx
                    <ReaderText style={[styles.facetBody, { color: palette.textBody }]}>{w.text}</ReaderText>
```

- [ ] **Step 4: 人物名册(`rosterName` / `rosterRole`)**

```tsx
                    <Text style={[styles.rosterName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</Text>
                    {!!c.role && <Text style={[styles.rosterRole, { color: palette.textSecondary }]}>{c.role}</Text>}
```
→
```tsx
                    <ReaderText style={[styles.rosterName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</ReaderText>
                    {!!c.role && <ReaderText style={[styles.rosterRole, { color: palette.textSecondary }]}>{c.role}</ReaderText>}
```

- [ ] **Step 5: 节拍(`beatAct` / `beatText`)**

```tsx
                    <Text style={[styles.beatAct, { color: palette.textPrimary }]}>{a.act}</Text>
                    {splitBeat(a.beat).map((para, j) => (
                      <Text key={j} style={[styles.beatText, { color: palette.textBody }, j > 0 && styles.beatTextGap]}>
                        {para}
                      </Text>
                    ))}
```
→
```tsx
                    <ReaderText style={[styles.beatAct, { color: palette.textPrimary }]}>{a.act}</ReaderText>
                    {splitBeat(a.beat).map((para, j) => (
                      <ReaderText key={j} style={[styles.beatText, { color: palette.textBody }, j > 0 && styles.beatTextGap]}>
                        {para}
                      </ReaderText>
                    ))}
```

- [ ] **Step 6: 人物详情(`detailName` / `detailRole` / `detailAge` / `bio` / `tagText` / `attrPanelValue`)**

`CharDetail` 内逐处替换:

```tsx
            <Text style={[styles.detailName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</Text>
            {!!c.role && <Text style={[styles.detailRole, { color: palette.textSecondary }]}>{c.role}</Text>}
            {!!ageGender && <Text style={[styles.detailAge, { color: palette.textSecondary }]}>{ageGender}</Text>}
```
→
```tsx
            <ReaderText style={[styles.detailName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</ReaderText>
            {!!c.role && <ReaderText style={[styles.detailRole, { color: palette.textSecondary }]}>{c.role}</ReaderText>}
            {!!ageGender && <ReaderText style={[styles.detailAge, { color: palette.textSecondary }]}>{ageGender}</ReaderText>}
```

小传正文(注意:保留上一行 `bioLabel` 为 `Text`):

```tsx
              <Text style={[styles.bio, { color: palette.textPrimaryAlt }]}>{bio}</Text>
```
→
```tsx
              <ReaderText style={[styles.bio, { color: palette.textPrimaryAlt }]}>{bio}</ReaderText>
```

标签值(`tagText`):

```tsx
                    <Text style={[styles.tagText, { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' }]}>
                      {tg.label}
                    </Text>
```
→
```tsx
                    <ReaderText style={[styles.tagText, { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' }]}>
                      {tg.label}
                    </ReaderText>
```

属性面板值(`attrPanelValue`,保留 `attrPanelLabel` / `attrPanelEmpty` 为 `Text`):

```tsx
                <Text style={[styles.attrPanelValue, { color: palette.textPrimaryAlt }]}>{activeTag.value}</Text>
```
→
```tsx
                <ReaderText style={[styles.attrPanelValue, { color: palette.textPrimaryAlt }]}>{activeTag.value}</ReaderText>
```

- [ ] **Step 7: 剧本正文(`scriptSlug` / `cueName` / `cueParen` / `cueText` / `action`)**

`ScriptView` 内(保留 `sceneMark` 为 `Text`):

```tsx
            <Text style={[styles.scriptSlug, { color: palette.textSecondary }]}>{s.slug}</Text>
```
→
```tsx
            <ReaderText style={[styles.scriptSlug, { color: palette.textSecondary }]}>{s.slug}</ReaderText>
```

```tsx
                  <Text style={[styles.cueName, { color: palette.textPrimary }]}>{b.cue}</Text>
                  {b.hasParen && <Text style={[styles.cueParen, { color: palette.textSecondary }]}>（{b.paren}）</Text>}
                  <Text style={[styles.cueText, { color: palette.textPrimaryAlt }]}>{b.text}</Text>
```
→
```tsx
                  <ReaderText style={[styles.cueName, { color: palette.textPrimary }]}>{b.cue}</ReaderText>
                  {b.hasParen && <ReaderText style={[styles.cueParen, { color: palette.textSecondary }]}>（{b.paren}）</ReaderText>}
                  <ReaderText style={[styles.cueText, { color: palette.textPrimaryAlt }]}>{b.text}</ReaderText>
```

```tsx
                <Text key={j} style={[styles.action, { color: palette.textPrimaryAlt }]}>
                  {b.text}
                </Text>
```
→
```tsx
                <ReaderText key={j} style={[styles.action, { color: palette.textPrimaryAlt }]}>
                  {b.text}
                </ReaderText>
```

- [ ] **Step 8: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 9: 提交**

```bash
git add apps/mobile/src/components/DocPanel.tsx
git commit -m "feat(mobile): 文档面板剧本文字改用 ReaderText,随档位缩放

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: 全量验证

**Files:** 无(只跑校验)。

- [ ] **Step 1: 跑全部单测**

Run: `pnpm exec vitest run`
Expected: 全部通过(含新增 `readingScale.test.ts`,以及现有 `charView.test.ts` 等不受影响)。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 自查剩余 chrome 未被误改**

Run: `grep -nE "secLabel|footerLabel|badgeText|coverTitle|tocNum|sceneMark" apps/mobile/src/components/InlineCard.tsx apps/mobile/src/components/DocPanel.tsx`
Expected: 这些样式仍由 `Text`(非 `ReaderText`)渲染。

- [ ] **Step 4(可选,需真机 / 模拟器):手动确认**

> ⚠️ 模拟器与 Metro 8081 是机器级共用资源(见 `CLAUDE.md`),起之前先确认不与其它 worktree 冲突。

`pnpm dev:ios` 起开发环境后:
1. 进设置页,看到「阅读」节,两组分档当前高亮「标准」,预览卡随点击实时变化。
2. 把字号调「特大」、行距调「宽松」,回对话看内联卡片、打开文档,剧本正文随之放大放宽;顶栏、眉标、页脚、聊天气泡不变。
3. 杀掉 app 重开,档位保留。

---

## Self-Review(写完后对照 spec)

- **Spec coverage:** provider(Task 2)、纯缩放(Task 1)、ReaderText(Task 3)、设置 UI + 预览(Task 5)、i18n 四语言(Task 4)、DocPanel/InlineCard 内容缩放与 chrome 排除(Task 6/7)、持久化键与默认标准档(Task 1/2)、系统缩放封顶(Task 3)、测试(Task 1 + 8)、验收(Task 8)。逐条有对应任务。
- **与 spec 的一处实现细化:** i18n 用独立映射 `READING_I18N` 而非改生成块 `DICT`(更贴合 `VOL_I18N` / `DOC_I18N` 既有模式);已在本计划与提交说明体现。
- **类型一致:** `FontLevel` / `LineLevel`(Task 1 定义)在 Task 2/5 一致引用;`useReadingPrefs` 返回字段在 Task 3/5 一致;`scaleReaderStyle` 签名在 Task 1/3 一致。
- **占位符扫描:** 无 TBD / 「类似上一个」;每个改动均给出确切前后代码。
