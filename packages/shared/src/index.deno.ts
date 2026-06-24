// @incipel/shared 的历史 Deno 专用入口。
//
// 内容与 index.ts 完全一致,差别只在 re-export 写显式 .ts 扩展名:Deno 的模块解析
// 严格要求扩展名。
//
// index.ts 保持无扩展名,供 Metro(Expo 客户端)与 Node/Vitest 按各自 sourceExts 解析——
// 二者对显式 .ts specifier 的支持不一,故两份入口并存。两份入口若有增删,需同步。

export * from './screenplay.ts';
export * from './agui.ts';
export * from './tools.ts';
