// 主题:设计 token。几何 / 排版 / 表面 / 描边 / 投影 严格对齐最新 handoff 原型;
// 品牌色 accent 取自 @incipel/shared 的 ACCENT_OPTIONS(可达 WCAG AA 的深色集),
// 正文文字色阶亦按 AA 选档——不照搬原型里达不到 AA 的浅灰(见本仓库既定无障碍决策)。
//
// 也就是说:本主题在「布局 / 间距 / 字号字重行高 / 圆角 / 表面底色 / 描边 / 投影」上与原型一致,
// 仅在「品牌色」与「正文文字灰阶」上保留可读性更高的取值。

import { Platform } from 'react-native';
import { ACCENT_OPTIONS } from '@incipel/shared';

// 默认主色(用户可在设置里改 accent)。原型默认色为亮陶土 #C2724E,但白字 CTA / 小字链接均不达 AA,
// 故沿用 @incipel/shared 的深陶土 #A8552E 等可达 AA 的同色系取值。
export const DEFAULT_ACCENT = ACCENT_OPTIONS[0];

// 两色按比例混合(t=0 取 a、t=1 取 b),用于由 accent 派生浅色底 / 浅色描边 / 按下态。
// 对齐原型 _mix(accent, '#FFFFFF', 0.88) 等派生方式。
function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return (
    '#' +
    A.map((v, i) => Math.round(v + ((B[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')
  );
}

// 全 app 唯一调色板。表面 / 描边 / 分隔线 / 投影底色 照搬原型字面值(它们只抬高、不降低正文对比度);
// 文字与品牌色保留 AA 取值(见上)。
export const palette = {
  // —— 表面 ——
  pageBg: '#FBFAF7', // app 基底(= 原型机身底);也是文档面板底、+ 圆按钮 / think 药丸底的「近白」
  cardBg: '#FFFFFF', // 主卡片 / 输入框 / 设置组 / 历史·作品卡 / 登录按钮底(原型多为纯白)
  cardAlt: '#FFFEFC', // 人物卡外层 / 单卡包裹(比纯白略暖)
  charHeaderBg: '#F6EFE7', // 人物卡头部底(暖陶土极浅)
  charHeaderBorder: '#EFE3D6', // 人物卡头部下边线
  panelBg: '#FCFBF8', // 侧边抽屉面板底
  sectionFooterBg: '#F8F5EF', // 卡片「展开到…」页脚底
  sectionFooterBgHover: '#F2EEE5', // 同上 hover/press
  noteBg: '#F5F2EC', // 文档「实时更新」提示底
  activeTagBg: '#FBF7F1', // 选中标签内容块底
  activeTagBorder: '#EFE7DB',
  chipTrackBg: '#F2EDE5', // 注册/登录 tab 轨道底 / 未选风格 chip 底
  hamburgerBg: '#F2EFE9', // 欢迎页汉堡圆底
  hamburgerBgHover: '#EBE7DF',
  controlBg: '#FBFAF7', // composer 里 + 圆按钮 / think 药丸底
  controlBgHover: '#F2EEE7',
  mutedBg: '#EDE8E0', // 弱表面(匿名头像底)
  selectionBg: '#F8EEE6', // 文档/卡片里被选中改写的文字块底
  selectionOutlineBg: '#FCF6F0', // 选中节拍块底
  avatarBg: '#2A2825', // 助手头像 / logo / 深色悬浮按钮 / 深色主按钮
  avatarBgHover: '#1F1C18',
  userBubbleBg: '#F1EEE8', // 用户气泡
  portraitEmptyBg: '#F5F1EA', // 头像占位(空)底
  portraitEmptyBgHover: '#F8F1E9',
  portraitLoadingBg: '#F2EDE5', // 头像占位(生成中)底
  portraitSpinnerTrack: '#E7DECF', // 头像 spinner 轨道
  regenBtnBg: 'rgba(255,255,255,0.92)', // 头像重生成小圆按钮底
  scrim: 'rgba(40,36,32,0.32)', // 抽屉遮罩
  sheetScrim: 'rgba(40,35,30,0.42)', // 底部 sheet 遮罩

  // —— 文字(均在浅底上达到 WCAG AA;不照搬原型浅灰)——
  textPrimary: '#2A2825', // 正文(深) ≈ 13:1
  textPrimaryAlt: '#36322C', // 正文(次深)
  textBody: '#54504A', // 文档正文(世界观 / 分场) ≈ 7:1
  textSecondary: '#645F58', // 次要文字(助手名 / 副标题 / 角色) ≈ 5.6:1
  placeholder: '#8C867C', // 输入占位 / 装饰性极浅标签(本仓库允许的最浅灰) ≈ 3.2:1

  // —— 语义(独立于品牌色)——
  danger: '#B0472E', // 错误 / 破坏性操作文字 ≈ 4.9:1(原型 #C0654A 不达 AA,取更深)
  dangerBg: '#FBEEEA', // 破坏性按钮 hover 底
  dangerBorder: '#ECDAD2', // 破坏性按钮描边(浅)

  // —— 线 / 装饰 ——
  border: '#E2DDD4', // 默认描边(输入框未聚焦 / 登录按钮)
  borderAlt: '#E8E3D9', // 卡片描边(更浅)
  borderCard: '#ECE7DD', // 文档世界观卡 / think 药丸 / + 按钮描边
  borderControl: '#E5E0D6', // 骰子按钮 / 文档导出按钮 / chat 头部「文档」按钮描边
  borderChip: '#E0DBD2', // 未选 genre / 标签 chip 描边
  divider: '#F0EDE7', // 分隔线
  dividerSoft: '#F2EFE9', // 更浅分隔线(卡片页脚上沿 / 列表项)
  dividerSheet: '#F1ECE4', // sheet 内分隔线
  dividerOptions: '#EDEAE3', // 快捷回复选项上沿
  pressedBg: '#F1EDE6', // 行按压底
  docDotInactive: '#CFC9BF', // chat 头部「文档」按钮未开时的小圆点
} as const;

// 标题字体:Noto Serif SC(衬线)。仅打包 600 一个字重,族名统一登记为 'Noto Serif SC'
//(原生 expo-font / web Google Fonts);原型本身亦只加载 ≤600 字重,故各处衬线落在同一字重。
export const fonts = {
  serifTitle: 'Noto Serif SC' as string,
  // 分场 slug / 正文用等宽。原生端 'ui-monospace' 是 CSS 通用族名、非已注册 RN 字体,
  // 直接传 fontFamily 会触发「Unrecognized font family」/ 回退异常,故按平台选已注册等宽族。
  mono: (Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace' }) ?? 'ui-monospace') as string,
  body: undefined as string | undefined, // 正文用系统默认
} as const;

// 投影预设(对齐原型 box-shadow;RN 用 shadow* + elevation 近似)。
export const shadows = {
  // logo:0 16px 34px -14px rgba(40,36,32,.55)
  logo: { shadowColor: '#282420', shadowOpacity: 0.32, shadowRadius: 17, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  // 抽屉浮动新建按钮:0 10px 24px -10px rgba(40,36,32,.5)
  floatBtn: { shadowColor: '#282420', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  // 抽屉面板:8px 0 40px -16px rgba(40,36,32,.45)
  drawer: { shadowColor: '#282420', shadowOpacity: 0.3, shadowRadius: 22, shadowOffset: { width: 8, height: 0 }, elevation: 16 },
  // 文档面板:0 -10px 40px -20px rgba(50,44,38,.4)
  docPanel: { shadowColor: '#322C26', shadowOpacity: 0.26, shadowRadius: 22, shadowOffset: { width: 0, height: -10 }, elevation: 16 },
  // 底部 sheet:0 -24px 60px -22px rgba(40,35,30,.55)
  sheet: { shadowColor: '#28231E', shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: -16 }, elevation: 24 },
  // 编辑条:0 -12px 30px -16px rgba(40,35,30,.28)
  editBar: { shadowColor: '#28231E', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: -8 }, elevation: 12 },
  // tab 选中态小投影:0 1px 3px rgba(40,36,32,.12)
  tab: { shadowColor: '#282420', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

export type Theme = {
  accent: string;
  accentSoft: string; // 由 accent 派生的浅色底(选中 chip / 上下文标签)
  accentSoftBorder: string; // 由 accent 派生的浅色描边
  accentHover: string; // 由 accent 派生的按下态
  palette: typeof palette;
  fonts: typeof fonts;
  shadows: typeof shadows;
  spacing: typeof spacing;
  radius: typeof radius;
};

// 由当前会话的 accent 组装主题对象,并派生浅色底 / 浅色描边 / 按下态(对齐原型混色比例)。
export function makeTheme(accent: string = DEFAULT_ACCENT): Theme {
  return {
    accent,
    accentSoft: mix(accent, '#FFFFFF', 0.88),
    accentSoftBorder: mix(accent, '#FFFFFF', 0.7),
    accentHover: mix(accent, '#000000', 0.2),
    palette,
    fonts,
    shadows,
    spacing,
    radius,
  };
}

export const defaultTheme: Theme = makeTheme();
