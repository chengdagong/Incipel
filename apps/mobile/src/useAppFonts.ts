// 字体加载(原生 iOS/Android)。
// 标题用 Noto Serif SC(衬线);此处只打包一个字重(SemiBold,≈14MB/字重),全部衬线标题共用。
// 字体族名统一登记为 'Noto Serif SC',与 useAppFonts.web.ts 用 Google Fonts 时的族名一致,
// 这样 theme.ts 里只用一个名字、各平台都能命中。
import { useFonts } from 'expo-font';
import { NotoSerifSC_600SemiBold } from '@expo-google-fonts/noto-serif-sc';

export function useAppFonts(): boolean {
  const [loaded] = useFonts({ 'Noto Serif SC': NotoSerifSC_600SemiBold });
  return loaded;
}
