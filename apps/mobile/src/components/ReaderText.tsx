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
