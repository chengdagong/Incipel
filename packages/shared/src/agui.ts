// AG-UI 协议原语统一来自 @ag-ui/core(单一事实来源);本文件只补充本项目自有的约定。
// 事件 wire 格式、字段与顺序见 .claude/skills/copilotkit-agui/references/。

import { EventType, type BaseEvent } from '@ag-ui/core';

export { EventType } from '@ag-ui/core';
export type { BaseEvent, RunAgentInput, Message, State } from '@ag-ui/core';

// RFC 6902 JSON Patch 操作(STATE_DELTA 的载荷)。
export type JsonPatchOp = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
};

// 本项目用一个 CUSTOM 事件承载某一轮的可点选项(quick reply)。
export const OPTIONS_EVENT_NAME = 'options';

export function optionsEvent(options: string[]): BaseEvent {
  return { type: EventType.CUSTOM, name: OPTIONS_EVENT_NAME, value: options } as unknown as BaseEvent;
}

// 把一个 AG-UI 事件序列化成一帧 SSE `data:`(以 text/event-stream 直接发送时)。
// agent 也可改用 @ag-ui/encoder 的 EventEncoder 以按 Accept 协商 SSE/protobuf。
export function sse(event: BaseEvent | Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
