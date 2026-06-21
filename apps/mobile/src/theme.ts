// 主题:主色取自 @incipel/shared 的 ACCENT_OPTIONS;其余调色板参考原型高保真稿。
// UI 不要求像素级还原,这里给出可被组件直接引用的设计 token。

import { ACCENT_OPTIONS } from '@incipel/shared';

// 默认主色(用户可在设置里改 accent,见 system-design §2.1「主题」)。
export const DEFAULT_ACCENT = ACCENT_OPTIONS[0];

// 原型配色(全 app 统一):页面底为暖米色,卡片近白,正文深棕。
// 这是全 app 唯一的调色板:抽屉 / 文档面板 / 设置页过去各自维护的字面色表已归并到这里,
// 组件只引用这些 token,改一处即全局生效。
//
// 文字色阶按 WCAG AA 重新定档:正文与次要文字在页面底(#F4F1EA)上对比度 ≥ 4.5:1。
// 占位、禁用填充、装饰线各自单列 token,不再与正文文字共用一个值(过去 textSecondaryAlt
// 同时当「浅文字」和「禁用底」用,无法同时满足两种需求)。语义色 danger 独立于品牌色 accent
// ——accent 用户可改(见 @incipel/shared ACCENT_OPTIONS),不应承载「错误」语义。
export const palette = {
  // 表面
  pageBg: '#F4F1EA', // 页面底(暖米色)
  cardBg: '#FBFAF7', // 卡片 / 文档面板底
  panelBg: '#FCFBF8', // 侧边抽屉面板
  userBubbleBg: '#E8E5DF', // 用户气泡(暖灰)
  mutedBg: '#EDE8E0', // 弱表面(匿名头像底等)
  noteBg: '#F5F2EC', // 文档面板「实时更新」提示底
  avatarBg: '#2B2926', // 助手头像底 / 深色悬浮按钮底
  sendBg: '#E7C6AF', // 发送按钮(柔和肉粉)
  disabledFill: '#B3AEA4', // 禁用按钮填充(仅做底色,不承载文字)
  scrim: 'rgba(40,36,32,0.32)', // 浮层遮罩

  // 文字(均在页面底上达到 WCAG AA)
  textPrimary: '#2A2825', // 正文(深) ≈ 13:1
  textPrimaryAlt: '#36322C', // 正文(次深)
  textBody: '#54504A', // 文档正文(世界观 / 分场内容) ≈ 7:1
  textSecondary: '#645F58', // 次要文字(助手名 / 副标题 / 时间 / 标签) ≈ 5.6:1
  placeholder: '#8C867C', // 输入占位 / 「待沉淀」提示 ≈ 3.2:1

  // 语义(独立于品牌色 accent)
  danger: '#B0472E', // 错误 / 破坏性操作 ≈ 4.9:1
  dangerBorder: '#ECDAD2', // 破坏性按钮描边(浅)

  // 线 / 装饰
  border: '#E2DDD4', // 描边
  borderAlt: '#E8E3D9', // 描边(更浅)
  divider: '#F0EDE7', // 分隔线
  pressedBg: '#F1EDE6', // 行按压底
  dot: '#A0A18E', // 「文档」chip 的小圆点(灰绿)
} as const;

// 标题字体:Noto Serif SC(衬线)。族名在 useAppFonts(原生 expo-font / web Google Fonts)中统一登记,
// 字体就绪前引用该族名会回退到系统体(启动时已 gate 加载,见 app/_layout.tsx)。
export const fonts = {
  serifTitle: 'Noto Serif SC' as string,
  body: undefined as string | undefined, // 用系统默认
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
  palette: typeof palette;
  fonts: typeof fonts;
  spacing: typeof spacing;
  radius: typeof radius;
};

// 由当前会话的 accent 组装一个主题对象。
export function makeTheme(accent: string = DEFAULT_ACCENT): Theme {
  return { accent, palette, fonts, spacing, radius };
}

export const defaultTheme: Theme = makeTheme();
