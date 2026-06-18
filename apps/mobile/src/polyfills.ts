// 原生(iOS/Android,Hermes)平台的 Web API polyfill。
// Hermes 缺一批 Web API,supabase-js 与 @ag-ui/client(SSE 流式)都依赖它们
// (见 system-design §13)。本文件必须在所有业务模块求值前最先被 import —— _layout.tsx 顶部第一行。
//
// 注意:这些副作用 import 的相对顺序很重要(import 在模块内会被提升,按文本先后求值),
// 故集中放在本文件里,由 _layout 以单条 import 引入,避免顺序被打乱。
//
// Web 平台(浏览器原生已具备这些 API)走同名的 polyfills.web.ts 空实现,
// 不引入 web-streams-polyfill —— 它会覆盖浏览器原生 ReadableStream,破坏 fetch 流式读取。
import 'react-native-get-random-values'; // crypto.getRandomValues — 必须最先(uuid/randomUUID 依赖)
import 'react-native-url-polyfill/auto'; // URL — supabase-js 用
// 自安装、自包含的 ES5 构建:把 ReadableStream/WritableStream/TransformStream 挂到 globalThis。
import 'web-streams-polyfill/dist/polyfill.es5.js';
import { TextEncoder, TextDecoder } from 'text-encoding';

{
  // text-encoding 无自安装入口,手动挂全局。
  const g = globalThis as Record<string, unknown>;
  if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoder;
  if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder;
}
