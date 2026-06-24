# 阅读区段落间距(第三档)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有字号 / 行距两档之上,给设置页加第三个分档「段落间距」,缩放剧本阅读正文里段落 / 块之间的间距。

**Architecture:** 段间距落在 `View` 的 margin / gap 上,`ReaderText`(只缩 fontSize / lineHeight)管不到,故在偏好 context 上新起 `paraScale` 维度,纯函数 `scaleGap` 取整缩放,在两处阅读表面的 8 个段落 / 块间距点用内联样式覆盖。

**Tech Stack:** React Native(Expo)、TypeScript、`@react-native-async-storage/async-storage`、Vitest。

## Global Constraints

- 设计文档:`docs/superpowers/specs/2026-06-24-reading-typography-scale-design.md` 末尾「增补:段落间距(第三档)」。
- 本机 `pnpm` 在 `/Users/chengdagong/.hermes/node/bin/pnpm`,**不在 PATH**;命令里 `pnpm` 按此全路径替换,所有 `pnpm` 命令在 `apps/mobile/` 下运行。
- `PARA_SCALES = { compact: 0.6, standard: 1, loose: 1.6 }`;`scaleGap(base, paraScale) = Math.round(base * paraScale)`。
- AsyncStorage 键 `scn_read_para_v1`,默认 `standard`;未知 / 损坏值回落 `standard`。
- 只缩 8 处段落 / 块间距;卡片之间(分面卡 `gap:10`、节拍卡 `gap:12`、内联卡片 `wrap.gap:16`)与结构性内边距(头部 / 页脚 / 标签到正文 / 徽标 / 标签 chip)**不动**。
- 默认标准档 `scaleGap(base, 1) = base`,升级零变化。
- 中文文案与 commit 用平实表达,不用行话黑话;commit 末尾带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 每个任务结束 `pnpm exec tsc --noEmit` 无报错再提交。

---

### Task 1: `readingScale.ts` 增段落间距纯逻辑 + 测试

**Files:**
- Modify: `apps/mobile/src/readingScale.ts`
- Modify: `apps/mobile/src/readingScale.test.ts`

**Interfaces:**
- Produces:`type ParaLevel = 'compact' | 'standard' | 'loose'`、`PARA_SCALES: Record<ParaLevel, number>`、`normalizeParaLevel(v: unknown): ParaLevel`、`scaleGap(base: number, paraScale: number): number`。

- [ ] **Step 1: 加失败测试**

In `apps/mobile/src/readingScale.test.ts`, change the import block to add the three new names:

```ts
import {
  FONT_SCALES,
  LINE_SCALES,
  PARA_SCALES,
  normalizeFontLevel,
  normalizeLineLevel,
  normalizeParaLevel,
  scaleGap,
  scaleReaderStyle,
} from './readingScale';
```

Then add these cases immediately before the final closing `});` of the `describe` block:

```ts
  it('段落间距档倍率取值', () => {
    expect(PARA_SCALES).toEqual({ compact: 0.6, standard: 1, loose: 1.6 });
  });

  it('段落间距未知 / 损坏值回落标准档', () => {
    expect(normalizeParaLevel('huge')).toBe('standard');
    expect(normalizeParaLevel(undefined)).toBe('standard');
    expect(normalizeParaLevel('loose')).toBe('loose');
    expect(normalizeParaLevel('compact')).toBe('compact');
  });

  it('scaleGap 取整缩放', () => {
    expect(scaleGap(10, 1)).toBe(10);
    expect(scaleGap(9, 0.6)).toBe(5); // 5.4 → 5
    expect(scaleGap(16, 1.6)).toBe(26); // 25.6 → 26
    expect(scaleGap(30, 0.6)).toBe(18); // 18.0 → 18
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/readingScale.test.ts`
Expected: FAIL —— `PARA_SCALES`/`normalizeParaLevel`/`scaleGap` 未从 `./readingScale` 导出。

- [ ] **Step 3: 写实现**

In `apps/mobile/src/readingScale.ts`, append after the existing `scaleReaderStyle` function:

```ts
export type ParaLevel = 'compact' | 'standard' | 'loose';

export const PARA_SCALES: Record<ParaLevel, number> = {
  compact: 0.6,
  standard: 1,
  loose: 1.6,
};

export function normalizeParaLevel(v: unknown): ParaLevel {
  return v === 'compact' || v === 'loose' ? v : 'standard';
}

// 段落 / 块之间的间距按段落间距档缩放;间距为整数像素,取整。
export function scaleGap(base: number, paraScale: number): number {
  return Math.round(base * paraScale);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/readingScale.test.ts`
Expected: PASS(共 11 个用例)。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/readingScale.ts apps/mobile/src/readingScale.test.ts
git commit -m "feat(mobile): 段落间距缩放纯逻辑 PARA_SCALES / scaleGap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `readingPrefs.tsx` 增段落间距维度

**Files:**
- Modify: `apps/mobile/src/readingPrefs.tsx`

**Interfaces:**
- Consumes(Task 1):`PARA_SCALES`、`normalizeParaLevel`、`ParaLevel`。
- Produces:`useReadingPrefs()` 返回值新增 `paraLevel: ParaLevel`、`setParaLevel: (l: ParaLevel) => void`、`paraScale: number`。

- [ ] **Step 1: 改导入**

In `apps/mobile/src/readingPrefs.tsx`, change the `./readingScale` import to add the three para names:

```tsx
import {
  FONT_SCALES,
  LINE_SCALES,
  PARA_SCALES,
  normalizeFontLevel,
  normalizeLineLevel,
  normalizeParaLevel,
  type FontLevel,
  type LineLevel,
  type ParaLevel,
} from './readingScale';
```

- [ ] **Step 2: 加存储键**

Below the existing `const LINE_KEY = 'scn_read_line_v1';`, add:

```tsx
const PARA_KEY = 'scn_read_para_v1';
```

- [ ] **Step 3: 扩展 `ReadingPrefs` 类型**

In the `export type ReadingPrefs = { ... }` block, add three fields (keep the existing ones):

```tsx
  paraLevel: ParaLevel;
  setParaLevel: (l: ParaLevel) => void;
  paraScale: number;
```

- [ ] **Step 4: 加状态、读取、写入、暴露**

In `ReadingPrefsProvider`:

a) After `const [lineLevel, setLineLevelState] = useState<LineLevel>('standard');` add:

```tsx
  const [paraLevel, setParaLevelState] = useState<ParaLevel>('standard');
```

b) In the mount `useEffect`, change the `Promise.all([...])` read to include the para key and apply it:

```tsx
    Promise.all([AsyncStorage.getItem(FONT_KEY), AsyncStorage.getItem(LINE_KEY), AsyncStorage.getItem(PARA_KEY)])
      .then(([f, l, p]) => {
        if (!mounted) return;
        if (f != null) setFontLevelState(normalizeFontLevel(f));
        if (l != null) setLineLevelState(normalizeLineLevel(l));
        if (p != null) setParaLevelState(normalizeParaLevel(p));
      })
      .catch(() => {});
```

c) After the existing `setLineLevel` `useCallback`, add:

```tsx
  const setParaLevel = useCallback((l: ParaLevel) => {
    setParaLevelState(l);
    void AsyncStorage.setItem(PARA_KEY, l).catch(() => {});
  }, []);
```

d) In the `useMemo` api object, add the three para fields and include `paraLevel` in the dependency array:

```tsx
  const api = useMemo<ReadingPrefs>(
    () => ({
      fontLevel,
      lineLevel,
      paraLevel,
      setFontLevel,
      setLineLevel,
      setParaLevel,
      fontScale: FONT_SCALES[fontLevel],
      lineScale: LINE_SCALES[lineLevel],
      paraScale: PARA_SCALES[paraLevel],
    }),
    [fontLevel, lineLevel, paraLevel, setFontLevel, setLineLevel, setParaLevel],
  );
```

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/readingPrefs.tsx
git commit -m "feat(mobile): 阅读偏好新增段落间距档(scn_read_para_v1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: i18n 增 `paraSpacing` + `sampleBeat2`

**Files:**
- Modify: `apps/mobile/src/i18n.tsx`

**Interfaces:**
- Produces:`READING_I18N[lang]` 新增字段 `paraSpacing`、`sampleBeat2`(四语言)。

- [ ] **Step 1: 扩展 `ReadingStrings` 类型**

In `apps/mobile/src/i18n.tsx`, in the `type ReadingStrings = { ... }` block, add two fields:

```tsx
  paraSpacing: string;
  sampleBeat2: string;
```

- [ ] **Step 2: 给四语言补字段**

In `READING_I18N`, add `paraSpacing` and `sampleBeat2` to each language object (place each right after that language's `sampleBeat`):

`zh`:
```tsx
    paraSpacing: '段落间距',
    sampleBeat2: '系统弹窗推送「连续关怀礼包」,埋下他被游戏机制捕获的伏笔。',
```
`en`:
```tsx
    paraSpacing: 'Paragraph spacing',
    sampleBeat2: 'A system pop-up pushes a "continuous care pack," foreshadowing how the game ensnares him.',
```
`ja`:
```tsx
    paraSpacing: '段落間隔',
    sampleBeat2: 'システムのポップアップが「継続ケアパック」を勧め、ゲームに絡め取られる伏線を張る。',
```
`zhHant`:
```tsx
    paraSpacing: '段落間距',
    sampleBeat2: '系統彈窗推送「連續關懷禮包」,埋下他被遊戲機制捕獲的伏筆。',
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错(若漏某语言字段,`Record<Lang, ReadingStrings>` 会报错)。

- [ ] **Step 4: 提交**

```bash
git add apps/mobile/src/i18n.tsx
git commit -m "feat(mobile): READING_I18N 增段落间距标签与第二条预览节拍(四语言)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 设置页加第三档「段落间距」+ 预览第二条节拍

**Files:**
- Modify: `apps/mobile/app/(app)/settings.tsx`

**Interfaces:**
- Consumes(Task 1、2、3):`scaleGap`、`ParaLevel`、`useReadingPrefs` 的 `paraLevel`/`setParaLevel`/`paraScale`、`READING_I18N` 的 `paraSpacing`/`sampleBeat2`。

- [ ] **Step 1: 改导入**

In `apps/mobile/app/(app)/settings.tsx`, change the readingScale type import to also bring `scaleGap` (runtime) and `ParaLevel`:

```tsx
import { scaleGap, type FontLevel, type LineLevel, type ParaLevel } from '../../src/readingScale';
```

- [ ] **Step 2: 取段落间距档 + 选项**

Change the `useReadingPrefs()` destructure to add the three para fields:

```tsx
  const { fontLevel, lineLevel, paraLevel, setFontLevel, setLineLevel, setParaLevel, paraScale } = useReadingPrefs();
```

After the existing `lineOptions` array, add:

```tsx
  const paraOptions: { value: ParaLevel; label: string }[] = [
    { value: 'compact', label: reading.lineCompact },
    { value: 'standard', label: reading.lineStandard },
    { value: 'loose', label: reading.lineLoose },
  ];
```

- [ ] **Step 3: 加第三档控件行**

In the JSX, the reading card currently closes after the line-spacing row. Replace this block:

```tsx
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
```

with (adds a third divider + row before the card closes):

```tsx
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
          <View style={styles.readingDivider} />
          <View style={styles.readingRow}>
            <Text style={styles.readingLabel}>{reading.paraSpacing}</Text>
            <Segmented
              options={paraOptions}
              value={paraLevel}
              onChange={setParaLevel}
              accent={accent}
              accentSoft={accentSoft}
              accentSoftBorder={accentSoftBorder}
            />
          </View>
        </View>
```

- [ ] **Step 4: 预览加第二条节拍(让段间距可见)**

Replace the preview card block:

```tsx
        <View style={styles.previewCard}>
          <Text style={[styles.previewEyebrow, { color: accent }]}>{reading.previewLabel}</Text>
          <ReaderText style={[styles.previewAct, { color: palette.textPrimary }]}>{reading.sampleAct}</ReaderText>
          <ReaderText style={[styles.previewBeat, { color: palette.textBody }]}>{reading.sampleBeat}</ReaderText>
        </View>
```

with (second beat carries the para-scaled top gap):

```tsx
        <View style={styles.previewCard}>
          <Text style={[styles.previewEyebrow, { color: accent }]}>{reading.previewLabel}</Text>
          <ReaderText style={[styles.previewAct, { color: palette.textPrimary }]}>{reading.sampleAct}</ReaderText>
          <ReaderText style={[styles.previewBeat, { color: palette.textBody }]}>{reading.sampleBeat}</ReaderText>
          <ReaderText style={[styles.previewBeat, { color: palette.textBody }, { marginTop: scaleGap(9, paraScale) }]}>
            {reading.sampleBeat2}
          </ReaderText>
        </View>
```

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add "apps/mobile/app/(app)/settings.tsx"
git commit -m "feat(mobile): 设置页加段落间距分档 + 预览第二条节拍

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `InlineCard` 段落 / 块间距随 `paraScale` 缩放

**Files:**
- Modify: `apps/mobile/src/components/InlineCard.tsx`

**Interfaces:**
- Consumes(Task 1、2):`scaleGap`、`useReadingPrefs`。

**4 个间距点:** 世界观段落 `bodyPara` 底距(8)、幕间(16)、节拍间(9)、场间(14)。基准值移到组件内 `scaleGap(...)` 调用,删除随之变死的纯间距样式。

- [ ] **Step 1: 加导入**

After `import { badgeBox, charView, splitBeat } from '../charView';` add:

```tsx
import { useReadingPrefs } from '../readingPrefs';
import { scaleGap } from '../readingScale';
```

- [ ] **Step 2: 取 `paraScale`**

In `InlineCard`, after `const { lang } = useI18n();` add:

```tsx
  const { paraScale } = useReadingPrefs();
```

- [ ] **Step 3: 世界观段落底距**

Replace:

```tsx
            <ReaderText key={w.id} style={[styles.bodyPara, { color: palette.textBody }]}>
              {w.title ? `${w.title} — ${w.text}` : w.text}
            </ReaderText>
```
with:
```tsx
            <ReaderText key={w.id} style={[styles.bodyPara, { color: palette.textBody }, { marginBottom: scaleGap(8, paraScale) }]}>
              {w.title ? `${w.title} — ${w.text}` : w.text}
            </ReaderText>
```

- [ ] **Step 4: 幕间 + 节拍间**

Replace:

```tsx
            <View key={a.id} style={i > 0 ? styles.outlineActGap : undefined}>
              <ReaderText style={[styles.outlineAct, { color: palette.textPrimary }]}>{a.act}</ReaderText>
              {splitBeat(a.beat).map((para, j) => (
                <ReaderText key={j} style={[styles.outlineBeat, { color: palette.textBody }, j > 0 && styles.outlineBeatGap]}>
                  {para}
                </ReaderText>
              ))}
            </View>
```
with:
```tsx
            <View key={a.id} style={i > 0 ? { marginTop: scaleGap(16, paraScale) } : undefined}>
              <ReaderText style={[styles.outlineAct, { color: palette.textPrimary }]}>{a.act}</ReaderText>
              {splitBeat(a.beat).map((para, j) => (
                <ReaderText key={j} style={[styles.outlineBeat, { color: palette.textBody }, j > 0 && { marginTop: scaleGap(9, paraScale) }]}>
                  {para}
                </ReaderText>
              ))}
            </View>
```

- [ ] **Step 5: 场间底距**

Replace:

```tsx
            <View key={s.id} style={styles.scene}>
```
with:
```tsx
            <View key={s.id} style={{ marginBottom: scaleGap(14, paraScale) }}>
```

- [ ] **Step 6: 清理变死的样式**

In the `StyleSheet.create`, remove the now-unused `marginBottom` from `bodyPara` and delete the three pure-gap styles. Change:

```tsx
  bodyPara: { fontSize: 13, lineHeight: 23, marginBottom: 8 },
```
to:
```tsx
  bodyPara: { fontSize: 13, lineHeight: 23 },
```

And delete these three lines entirely (their values now live in the `scaleGap(...)` calls):

```tsx
  outlineActGap: { marginTop: 16 },
```
```tsx
  outlineBeatGap: { marginTop: 9 },
```
```tsx
  scene: { marginBottom: 14 },
```

- [ ] **Step 7: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错(若漏删某处引用,会报 `styles.scene` 等不存在)。

- [ ] **Step 8: 提交**

```bash
git add apps/mobile/src/components/InlineCard.tsx
git commit -m "feat(mobile): 内联卡片段落 / 块间距随段落间距档缩放

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `DocPanel` 段落 / 块间距随 `paraScale` 缩放

**Files:**
- Modify: `apps/mobile/src/components/DocPanel.tsx`

**Interfaces:**
- Consumes(Task 1、2):`scaleGap`、`useReadingPrefs`。

**4 个间距点:** 节拍间 `beatTextGap`(9,在 `DocSheet`)、场间 script 包裹 `gap`(30,在 `ScriptView`)、动作块底距(12,`ScriptView`)、对白块底距(12,`ScriptView`)。`DocSheet` 与 `ScriptView` 各自取一次 `paraScale`。

- [ ] **Step 1: 加导入**

After `import { PortraitThumb } from './PortraitThumb';` add:

```tsx
import { useReadingPrefs } from '../readingPrefs';
import { scaleGap } from '../readingScale';
```

- [ ] **Step 2: `DocSheet` 取 `paraScale`,缩节拍间距**

In `DocSheet`, after the line `const { meta, world, characters, outline, scenes } = screenplay;` add:

```tsx
  const { paraScale } = useReadingPrefs();
```

Then in the beats view, replace:

```tsx
                      <ReaderText key={j} style={[styles.beatText, { color: palette.textBody }, j > 0 && styles.beatTextGap]}>
                        {para}
                      </ReaderText>
```
with:
```tsx
                      <ReaderText key={j} style={[styles.beatText, { color: palette.textBody }, j > 0 && { marginTop: scaleGap(9, paraScale) }]}>
                        {para}
                      </ReaderText>
```

- [ ] **Step 3: `ScriptView` 取 `paraScale`,缩场 / 动作 / 对白间距**

Change the `ScriptView` signature line + body. Replace:

```tsx
function ScriptView({ scenes, accent }: { scenes: Screenplay['scenes']; accent: string }) {
  return (
    <View style={{ gap: 30, marginTop: 18 }}>
```
with:
```tsx
function ScriptView({ scenes, accent }: { scenes: Screenplay['scenes']; accent: string }) {
  const { paraScale } = useReadingPrefs();
  return (
    <View style={{ gap: scaleGap(30, paraScale), marginTop: 18 }}>
```

Replace the dialogue block wrapper:

```tsx
                <View key={j} style={styles.cueBlock}>
```
with:
```tsx
                <View key={j} style={{ marginBottom: scaleGap(12, paraScale) }}>
```

Replace the action paragraph:

```tsx
                <ReaderText key={j} style={[styles.action, { color: palette.textPrimaryAlt }]}>
                  {b.text}
                </ReaderText>
```
with:
```tsx
                <ReaderText key={j} style={[styles.action, { color: palette.textPrimaryAlt }, { marginBottom: scaleGap(12, paraScale) }]}>
                  {b.text}
                </ReaderText>
```

- [ ] **Step 4: 清理变死的样式**

In `StyleSheet.create`, remove the now-unused `marginBottom` from `action` and delete the two pure-gap styles. Change:

```tsx
  action: { fontSize: 13, lineHeight: 24, marginBottom: 12 },
```
to:
```tsx
  action: { fontSize: 13, lineHeight: 24 },
```

Delete these two lines (values now live in `scaleGap(...)` calls):

```tsx
  beatTextGap: { marginTop: 9 },
```
```tsx
  cueBlock: { marginBottom: 12 },
```

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/components/DocPanel.tsx
git commit -m "feat(mobile): 文档面板段落 / 块间距随段落间距档缩放

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 全量验证

**Files:** 无(只跑校验)。

- [ ] **Step 1: 全部单测**

Run: `pnpm exec vitest run`
Expected: 全部通过(`readingScale.test.ts` 含 3 个新段落间距用例,其余不受影响)。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 自查卡片间距未被误改**

Run: `grep -nE "gap: 10|gap: 12|wrap: \{ marginTop: 13, gap: 16" apps/mobile/src/components/InlineCard.tsx apps/mobile/src/components/DocPanel.tsx`
Expected: 内联卡片 `wrap.gap:16`、文档世界观分面 `gap:10`、节拍卡 `gap:12` 仍为静态值(卡片间距不随段落间距档变)。

- [ ] **Step 4(可选,需真机 / 模拟器):手动确认**

> ⚠️ 模拟器与 Metro 8081 是机器级共用资源(见 `CLAUDE.md`),起之前先确认不与其它 worktree 冲突。

`pnpm dev:ios` 后:设置页出现第三档「段落间距」;调「宽松」/「紧凑」,预览两条节拍间距、对话内联卡片与文档里节拍 / 段落 / 对白 / 场 / 幕间距随之变化;卡片之间、头部 / 页脚不变;重开 app 档位保留。

---

## Self-Review(写完后对照 spec)

- **Spec coverage:** 纯逻辑(Task 1)、provider 第三维 + 持久化键(Task 2)、i18n 标签 + 第二预览节拍(Task 3)、设置第三档 + 预览(Task 4)、8 处间距点缩放(Task 5 四处 + Task 6 四处)、卡片 / 结构间距不动(Task 5/6 只改列出的点 + Task 7 自查)、默认标准档零变化(`scaleGap(base,1)=base`,Task 1)、测试(Task 1 + 7)。逐条有任务。
- **类型一致:** `ParaLevel`(Task 1)在 Task 2/4 一致;`useReadingPrefs` 新增 `paraLevel/setParaLevel/paraScale`(Task 2)在 Task 4/5/6 一致;`scaleGap(base, paraScale)` 签名(Task 1)在 Task 4/5/6 一致;`READING_I18N` 新字段 `paraSpacing`/`sampleBeat2`(Task 3)在 Task 4 一致。
- **占位符扫描:** 无 TBD / 「类似上一个」;每处改动给出确切前后代码与样式删除项。
