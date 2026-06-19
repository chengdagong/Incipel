// 主题:主色取自 @incipel/shared 的 ACCENT_OPTIONS;其余调色板参考原型高保真稿。
// UI 不要求像素级还原,这里给出可被组件直接引用的设计 token。

import { ACCENT_OPTIONS } from '@incipel/shared';

// 默认主色(用户可在设置里改 accent,见 system-design §2.1「主题」)。
export const DEFAULT_ACCENT = ACCENT_OPTIONS[0];

// 原型配色(全 app 统一):页面底为暖米色,卡片近白,正文深棕。
export const palette = {
  pageBg: '#F4F1EA', // 页面底(暖米色)
  cardBg: '#FBFAF7', // 卡片
  userBubbleBg: '#E8E5DF', // 用户气泡(暖灰)
  avatarBg: '#2B2926', // 助手头像底(深)
  sendBg: '#E7C6AF', // 发送按钮(柔和肉粉)
  dot: '#A0A18E', // 「文档」chip 的小圆点(灰绿)
  textPrimary: '#2A2825', // 正文(深)
  textPrimaryAlt: '#36322C', // 正文(次深)
  textSecondary: '#9A958C', // 次要
  textSecondaryAlt: '#B3AEA4', // 次要(更浅)
  border: '#E2DDD4', // 描边
  borderAlt: '#E8E3D9', // 描边(更浅)
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
