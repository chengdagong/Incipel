// 字体加载(web)。
// 不打包 14MB 的 TTF;改从 Google Fonts CDN 取 Noto Serif SC —— CDN 按 unicode-range 切片,
// 浏览器只下载标题实际用到的字形块。族名为 'Noto Serif SC',与 useAppFonts.ts(原生)一致。
import { useEffect } from 'react';

let injected = false;

export function useAppFonts(): boolean {
  useEffect(() => {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const preconnect1 = document.createElement('link');
    preconnect1.rel = 'preconnect';
    preconnect1.href = 'https://fonts.googleapis.com';
    const preconnect2 = document.createElement('link');
    preconnect2.rel = 'preconnect';
    preconnect2.href = 'https://fonts.gstatic.com';
    preconnect2.crossOrigin = 'anonymous';
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&display=swap';
    document.head.append(preconnect1, preconnect2, sheet);
  }, []);

  // 不阻塞首屏:display=swap 会先用回退体,字体就绪后自动替换。
  return true;
}
