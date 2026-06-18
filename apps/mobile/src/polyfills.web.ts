// Web 平台 polyfill:空实现。
// 浏览器原生已具备 crypto.getRandomValues / URL / ReadableStream / TextEncoder/Decoder,
// 无需任何 polyfill;尤其不能引入 web-streams-polyfill —— 它会覆盖原生 ReadableStream,
// 破坏 fetch 的 response.body 流式读取(@ag-ui/client 读 SSE 依赖原生实现)。
//
// 与 polyfills.ts 同名,Metro 在 web 平台优先解析本 .web.ts 版本。
export {};
