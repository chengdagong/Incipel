// 面向用户的名称(见 CONTEXT.md「名称」)。集中一处,避免散落各页面。
//
// - PRODUCT_NAME:产品名「织幕」(暂定)。代号 Incipel 仅用于包名 / slug / bundleId,不向用户呈现。
// - DEFAULT_ASSISTANT_NAME:AI 助手的默认显示名「主管编剧」。助手名与产品名是两回事,
//   且可由用户自定义——日后从用户设置读取覆盖此默认值,并随 /run 的 forwardedProps.assistantName
//   传给 agent(服务端已留入口)。

export const PRODUCT_NAME = '织幕';

export const DEFAULT_ASSISTANT_NAME = '主管编剧';
