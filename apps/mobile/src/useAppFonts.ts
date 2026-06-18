// 字体加载(原生 iOS/Android)。
// 标题用 Noto Serif SC(衬线);此处只打包一个字重(SemiBold,≈14MB/字重),全部衬线标题共用。
// 字体族名统一登记为 'Noto Serif SC',与 useAppFonts.web.ts 用 Google Fonts 时的族名一致,
// 这样 theme.ts 里只用一个名字、各平台都能命中。
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { NotoSerifSC_600SemiBold } from '@expo-google-fonts/noto-serif-sc';

export function useAppFonts(): boolean {
  // useFonts 第二个返回值是加载错误。衬线标题只是装饰:加载失败时记录并放行,
  // 回退系统字体,绝不能因为一个装饰字体把整个 app 永远卡在启动屏
  //(app/_layout.tsx 的 ready = sessionReady && fontsLoaded 会 gate 所有路由)。
  const [loaded, error] = useFonts({ 'Noto Serif SC': NotoSerifSC_600SemiBold });
  useEffect(() => {
    if (error) console.warn('[fonts] Noto Serif SC 加载失败,回退系统衬线体:', error);
  }, [error]);
  return loaded || !!error;
}
