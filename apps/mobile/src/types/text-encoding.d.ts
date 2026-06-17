// text-encoding 没有自带类型;这里给 polyfill 用到的两个构造器一份最小声明。
// 只在 app/_layout.tsx 里以「赋值到 globalThis」的方式使用,不直接当类型用。
declare module 'text-encoding' {
  export const TextEncoder: typeof globalThis.TextEncoder;
  export const TextDecoder: typeof globalThis.TextDecoder;
}
