# 阅读区字号 / 行距可调 —— 设计文档

- 日期:2026-06-24
- 状态:已通过设计评审,待写实现计划
- 范围:`apps/mobile`

## 背景与问题

剧本内容(文档面板与对话内联卡片)的字号、行高目前是各组件里写死的常量,
密集中文读起来偏挤(此前「大纲」内联卡片节拍连成一坨即是一例)。用户希望在 app 内
**自行调整字号与行距**,两者分开调,而不是只能改某一处或依赖系统设置。

## 目标 / 非目标

**目标**
- 在设置页提供两个独立分档控件:字号 4 档、行距 3 档。
- 调整即时作用于**剧本内容**:文档面板(`DocPanel`)与对话内联卡片(`InlineCard`)里用户阅读的剧本文字。
- 设置本机持久化,重启后保留。
- 默认档位等于现状,老用户与现有版面零变化,要调才调。

**非目标(YAGNI)**
- 不缩放界面 chrome(导航、设置页自身、按钮、聊天气泡)。
- 不做字体族选择。
- 不做按单个文档 / 单条消息的局部覆盖。
- 不做无级滑块。
- 不跨设备同步(与语言一致,仅存本机)。

## 已定决策

| 决策点 | 选择 |
| --- | --- |
| 作用范围 | 仅剧本内容(`DocPanel` + `InlineCard`),chrome 不动 |
| 控件形式 | 两组分档按钮(字号 4 档、行距 3 档),各自独立 |
| 应用机制 | `ReaderText` 包装组件,在两处阅读表面把 `Text` 换成它 |
| 持久化 | AsyncStorage,照搬 i18n 的 provider 写法 |
| 与系统缩放关系 | 保留 RN 默认 `allowFontScaling`,app 内档位与系统无障碍缩放叠加,封顶 |

## 架构

### 1. 偏好 provider:`src/readingPrefs.tsx`

完全照搬 `src/i18n.tsx` 的 provider 模式:`createContext` + `useState` + 启动 `AsyncStorage.getItem`
读取 + `setX` 时 `AsyncStorage.setItem` 写回。挂在 `app/_layout.tsx`,与 `I18nProvider` 同层,
包住全 app(含设置页与阅读表面)。

对外接口:

```ts
type FontLevel = 'small' | 'standard' | 'large' | 'xlarge';
type LineLevel = 'compact' | 'standard' | 'loose';

type ReadingPrefs = {
  fontLevel: FontLevel;
  lineLevel: LineLevel;
  setFontLevel: (l: FontLevel) => void;
  setLineLevel: (l: LineLevel) => void;
  fontScale: number; // 由 fontLevel 经纯函数映射
  lineScale: number; // 由 lineLevel 经纯函数映射
};
```

- 前四个字段供设置页渲染分档与高亮当前档;后两个数值供 `ReaderText`。
- AsyncStorage 键:`scn_read_font_v1`、`scn_read_line_v1`(沿用 `scn_<域>_v1` 命名)。
- 读到未知 / 损坏值时回落到 `standard`。

### 2. 纯缩放模块:`src/readingScale.ts`

不引入任何 React Native,便于用 vitest 直接测(与 `charView.ts` / `readingScale.test.ts` 同风格)。

```ts
export const FONT_SCALES: Record<FontLevel, number> = {
  small: 0.9, standard: 1.0, large: 1.15, xlarge: 1.3,
};
export const LINE_SCALES: Record<LineLevel, number> = {
  compact: 0.92, standard: 1.0, loose: 1.15,
};

// 把一份文字样式按当前缩放算出新的 fontSize / lineHeight。
// 行高先随字号等比(× fontScale),再叠加行距档(× lineScale);缺哪个字段就不动哪个。
export function scaleReaderStyle(
  style: { fontSize?: number; lineHeight?: number },
  fontScale: number,
  lineScale: number,
): { fontSize?: number; lineHeight?: number };
```

**缩放公式**
- `fontSize = base.fontSize × fontScale`
- `lineHeight = base.lineHeight × fontScale × lineScale`
- 没写 `lineHeight` 的样式(多为单行 / 标题,RN 自动行高跟字号)不受行距档影响,可接受。

**档位含义(标准 = 现状,倍率 1.0)**
- 字号:小 `0.9` / 标准 `1.0` / 大 `1.15` / 特大 `1.3`
- 行距:紧凑 `0.92` / 标准 `1.0` / 宽松 `1.15`

### 3. 包装组件:`src/components/ReaderText.tsx`

```tsx
export function ReaderText({ style, ...rest }: TextProps) {
  const { fontScale, lineScale } = useReadingPrefs();
  const flat = StyleSheet.flatten(style) ?? {};
  const scaled = scaleReaderStyle(flat, fontScale, lineScale);
  return <Text {...rest} style={[flat, scaled]} maxFontSizeMultiplier={1.6} />;
}
```

- `flatten` 把数组样式(含动态 `{ color }`)拍平,再覆盖算出的 `fontSize` / `lineHeight`,其余属性(`numberOfLines` 等)经 `...rest` 透传。
- 读 context,故档位一改即重渲染、实时生效。
- `maxFontSizeMultiplier={1.6}` 给系统无障碍缩放封顶,避免「系统最大 + app 特大」撑破版面。

### 4. 阅读表面改动:`DocPanel` 与 `InlineCard`

**分类规则**
- **剧本内容正文**(用户阅读的剧本文字)→ 用 `ReaderText`,随档位缩放。
- **结构性 chrome**(卡片骨架、定位标签)→ 保持原生 `Text`,固定字号,保证版面稳定。

**`InlineCard.tsx`**
- 参与缩放:世界观正文 `bodyPara`;人物名 `charName`、角色 `charRole`、年龄性别 `charAge`、小传 `bio`、标签 `tagText`;大纲幕名 `outlineAct`、节拍 `outlineBeat`;分场 `sceneSlug`、`sceneContent`。
- 不动:区块眉标 `secLabel`(「世界观 / 大纲 / 分场」)、「打开…」页脚 `footerLabel`、身份徽标 `badgeText`、`noIdentity` 眉标。

**`DocPanel.tsx`**
- 参与缩放:世界观正文、人物名 / 角色 / 年龄 / 小传 / 标签值、节拍幕名 `beatAct` 与正文 `beatText`、分场 slug 与正文、封面 logline `coverLogline`、属性面板值 `attrPanelValue`、动作行 `action`。
- 不动:顶栏(`back` / `volTitle`)、各处眉标(`eyebrow` / `coverEyebrow` / `tocLabel` / `attrPanelLabel`)、目录序号 `tocNum`、封面大标题 `coverTitle`、区块 chrome。

> 确切的逐节点清单在实现计划(writing-plans)里按上述规则枚举核对;本设计定的是规则与分类,不是逐行清单。

### 5. 设置界面:`app/(app)/settings.tsx`

在现有「通用」节之后新增「阅读」一节,沿用现有卡片 / 行 / 分隔线观感,不引入新依赖:

- 一张卡,两行:
  - 「字号」+ 一排 4 个等宽药丸按钮(小 / 标准 / 大 / 特大)。
  - 一条分隔线。
  - 「行距」+ 一排 3 个等宽药丸按钮(紧凑 / 标准 / 宽松)。
- 选中态:暖色浅底 + 主色字 + 主色浅描边(`accentSoft` / `accentSoftBorder`,沿用语言项选中观感);未选:白底 + 次要文字色 + chip 描边。
- 卡下一段说明:「只影响剧本内容(文档与对话里的卡片),不改界面其它文字。」
- 说明下一张「预览」卡:用 `ReaderText` 渲染一小段剧本式样例(幕名 + 一句节拍),实时反映当前档位。
- 标签独占一行、药丸整行平铺(380px 宽下 4 档每档约 85px,中文短标签够放)。

布局机制为分档按钮(`Pressable` 药丸),无滑块依赖;移动端单列,药丸 `flex:1` 等宽。

## 持久化与系统级缩放

- 本机 AsyncStorage,键 `scn_read_font_v1` / `scn_read_line_v1`;仅存本机、不同步。
- 保留 RN 默认 `allowFontScaling`(true),系统「字体大小」无障碍设置仍叠加生效;
  `ReaderText` 以 `maxFontSizeMultiplier={1.6}` 封顶。net 字号 = `base × fontScale × min(系统缩放, 1.6)`。

## i18n

往 `apps/mobile/src/i18n.tsx` 加键,覆盖全部支持语言(`zh` / `en` / `ja` / `zhHant`),
按文件现有「逐键的语言覆盖」习惯补齐:

- 节标题:`readingSection`(阅读 / Reading / 表示 / 閱讀)
- 行标签:`fontSizeLabel`(字号)、`lineSpacingLabel`(行距)
- 字号档名:`fontSmall` / `fontStandard` / `fontLarge` / `fontXLarge`
- 行距档名:`lineCompact` / `lineStandard` / `lineLoose`
- 说明:`readingDesc`
- 预览样例:`readingSampleAct`(幕名)、`readingSampleBeat`(节拍句)

## 测试

`apps/mobile/src/readingScale.test.ts`(vitest,纯逻辑):

- 档位 → 倍率映射正确(`FONT_SCALES` / `LINE_SCALES` 全档)。
- 未知 / 损坏档位回落 `standard`。
- `scaleReaderStyle`:
  - 同时含 `fontSize` + `lineHeight`:`fontSize × fontScale`、`lineHeight × fontScale × lineScale`。
  - 仅 `fontSize`:只缩 `fontSize`,不凭空造 `lineHeight`。
  - 仅 `lineHeight` / 空样式:对应分支不报错、按规则处理。
  - 标准 / 标准档(1.0 / 1.0):输出等于输入(零变化)。

`ReaderText`、provider 的渲染行为不写 RN 渲染测试(项目现有测试均为纯逻辑),逻辑已被纯函数覆盖。

## 涉及文件

**新增**
- `apps/mobile/src/readingPrefs.tsx` —— 偏好 provider + `useReadingPrefs` hook。
- `apps/mobile/src/readingScale.ts` —— 纯映射 + `scaleReaderStyle`。
- `apps/mobile/src/components/ReaderText.tsx` —— 缩放包装组件。
- `apps/mobile/src/readingScale.test.ts` —— 纯逻辑测试。

**改动**
- `apps/mobile/app/_layout.tsx` —— 挂 `ReadingPrefsProvider`。
- `apps/mobile/app/(app)/settings.tsx` —— 新增「阅读」节 + 分档控件 + 预览。
- `apps/mobile/src/components/DocPanel.tsx` —— 内容文字 `Text` → `ReaderText`。
- `apps/mobile/src/components/InlineCard.tsx` —— 内容文字 `Text` → `ReaderText`。
- `apps/mobile/src/i18n.tsx` —— 新增 i18n 键。

## 边界情形

- 缺 `lineHeight` 的样式不受行距档影响(已说明,可接受)。
- 损坏 / 旧存储值 → 回落标准档。
- 系统无障碍缩放叠加 → `maxFontSizeMultiplier` 封顶。
- 标准 / 标准为默认 → 升级后无声变样。

## 验收标准

1. 设置页「阅读」节出现,两组分档按钮,当前档高亮;预览卡随选择实时变化。
2. 改字号 / 行距后,文档面板与内联卡片的剧本正文随之变化;chrome、聊天气泡、设置页自身字号不变。
3. 重启 app 后档位保留。
4. 默认安装(未调过)时,阅读表面与改动前像素一致。
5. `readingScale.test.ts` 全部通过,`tsc --noEmit` 无报错。

---

## 增补:段落间距(第三档)

日期:2026-06-24(同分支后续增量)。在已有字号 / 行距两档之上,加第三个独立分档「段落间距」。

### 目标 / 范围

- 调整剧本阅读正文里**段落 / 块之间**的竖向间距:标题与下方第一段正文之间、节拍之间、世界观段落之间、对白 / 动作块之间、场与场、幕与幕。
- 默认标准档倍率 1.0,升级零变化。
- **不含**:卡片与卡片之间(分面卡、节拍卡、内联卡片之间)、结构性内边距(头部 / 页脚 / 非剧本内容标签到正文 / 徽标 / 标签 chip)。

### 机制

段落间距落在 `View` 的 margin / gap 上,`ReaderText`(只缩 fontSize / lineHeight)管不到,故另起一维 `paraScale`。

`readingScale.ts` 增:
- `type ParaLevel = 'compact' | 'standard' | 'loose'`
- `PARA_SCALES: Record<ParaLevel, number> = { compact: 0.6, standard: 1, loose: 1.6 }`
- `normalizeParaLevel(v: unknown): ParaLevel`(未知 / 损坏回落 `standard`)
- `scaleGap(base: number, paraScale: number): number = Math.round(base * paraScale)`(间距为整数像素)
- `TITLE_BODY_GAPS` + `scaleTitleBodyGap(key, paraScale)`:标题与下方第一段正文之间也按段落间距档缩放,标准档保持原有基准值。

`readingPrefs.tsx` 增 `paraLevel / setParaLevel / paraScale`(`paraScale = PARA_SCALES[paraLevel]`),AsyncStorage 键 `scn_read_para_v1`,默认 `standard`。

### 参与缩放的主要间距点

设置页预览:
- 幕名到第一条节拍的间距(7)
- 两条节拍之间的间距(9)

`InlineCard.tsx`:
- 世界观段落 `bodyPara` 的 `marginBottom`(8)
- 幕间 `outlineActGap` 的 `marginTop`(16)
- 幕名 `outlineAct` 到第一条节拍的 `marginBottom`(7)
- 节拍间 `outlineBeatGap` 的 `marginTop`(9)
- 场间 `scene` 的 `marginBottom`(14)
- 场标题 `sceneSlug` 到正文的 `marginBottom`(7)

`DocPanel.tsx`:
- 世界设定标题 `facetLabelRow` 到正文的 `marginBottom`(8)
- 幕名 `beatAct` 到第一段节拍的 `marginBottom`(6)
- 节拍间 `beatTextGap` 的 `marginTop`(9)
- 场间 script 包裹 `View` 的 `gap`(30;`marginTop: 18` 是顶部偏移,结构性,不动)
- 场标题 `scriptSlug` 到第一段正文的 `marginBottom`(14)
- 动作块 `action` 的 `marginBottom`(12)
- 对白块 `cueBlock` 的 `marginBottom`(12)

做法:把上述静态 margin / gap 换成组件内读 `paraScale` 算出的值(`scaleGap(base, paraScale)`),以内联样式覆盖。`bodyPara` 等同时被 `ReaderText` 缩放的节点,内联 margin 经 `ReaderText` 的 `style={[flat, scaled]}` 透传(`scaled` 只覆盖 font / line,不动 margin)。

### 设置界面

设置页「阅读」节加第三个分档行「段落间距」(紧凑 / 标准 / 宽松),沿用同一 `Segmented` 控件。预览卡改为「幕名 + 两条节拍」,使节拍之间的段间距在预览里随档实时可见。

### i18n

`READING_I18N` 加行标签 `paraSpacing`(段落间距 / Paragraph spacing / 段落間隔 / 段落間距),四语言齐全。档名复用现有 `紧凑 / 标准 / 宽松`(与行距同词,不另造词条)。

### 测试

`readingScale.test.ts` 增:
- `PARA_SCALES` 取值(`{ compact: 0.6, standard: 1, loose: 1.6 }`)。
- `normalizeParaLevel` 回落标准档。
- `scaleGap` 取整:`scaleGap(9, 0.6) = 5`、`scaleGap(16, 1.6) = 26`、`scaleGap(30, 0.6) = 18`、`scaleGap(10, 1) = 10`。
- `scaleTitleBodyGap` 取整:标准档保持原有基准值,紧凑 / 宽松档随 `paraScale` 改变。

### 涉及文件

改:`readingScale.ts`、`readingPrefs.tsx`、`app/(app)/settings.tsx`、`InlineCard.tsx`、`DocPanel.tsx`、`i18n.tsx`、`readingScale.test.ts`。无新文件。

### 验收

1. 设置页出现第三档「段落间距」,当前档高亮;预览随选择实时变化(幕名到第一条节拍、两条节拍之间的间距都可见)。
2. 改段落间距后,内联卡片与文档里标题到第一段正文、节拍 / 段落 / 对白 / 场 / 幕之间的间距随之变化;卡片之间、结构性内边距不变。
3. 重启保留;标准档与改动前像素一致。
4. `readingScale.test.ts` 全部通过,`tsc --noEmit` 无报错。
