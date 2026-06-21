// 模型抽象层。China 访问/合规存在不确定性,把 provider 抽象在 agent 层,客户端无感切换。
//
// 重要约束(见 docs/adr/0001):v1 只接 *tool-use 可靠* 的 provider。剧本的所有改动都走
// 结构化 tool use,没有任何文本解析降级路径。要接 tool-use 较弱的模型,必须由其适配器
// 把结构化提示包装成与此一致的 tool-use 接口,而不是引入第二套契约。

import type { z } from 'zod';

// 一次工具调用:工具名 + 已解析好的参数对象。参数 schema 由 @incipel/shared 的
// buildToolSchemas(idSetsOf(state)) 按当前剧本状态生成(含 id 枚举门控)。
export type ToolCall = {
  // 模型为本次调用分配的 id(用于 AG-UI 的 TOOL_CALL_* 事件关联)。
  toolCallId: string;
  toolName: string;
  args: unknown;
};

// streamTurn 产出的增量事件。一轮里文本与工具调用交错产生。
export type StreamChunk =
  | { type: 'text'; delta: string }
  // 工具调用参数开始流式到达(可选,用于 TOOL_CALL_START)。
  | { type: 'tool-call-start'; toolCallId: string; toolName: string }
  // 一次工具调用参数齐备、已按 schema 解析。
  | { type: 'tool-call'; call: ToolCall };

// 一轮的输入:稳定 system(走 prompt caching)、本轮拼好的 prompt、按状态生成的工具集。
export type StreamTurnInput = {
  system: string;
  prompt: string;
  // 工具名 -> Zod 参数 schema。来自 buildToolSchemas(idSetsOf(state))。
  tools: Record<string, z.ZodTypeAny>;
};

export type CompleteLoglineInput = {
  system: string;
  prompt: string;
};

export interface ModelProvider {
  // 流式跑一轮:产出文本增量与工具调用(交错)。
  streamTurn(input: StreamTurnInput): AsyncIterable<StreamChunk>;
  // 一次性短文本补全(/logline 用便宜模型)。
  completeLogline(input: CompleteLoglineInput): Promise<string>;
}

// 'stub' 仅供本地 / E2E:产出写死的确定性回合,不调任何真实模型(见 model/stub.ts)。prod 永不设。
export type ProviderName = 'anthropic' | 'openrouter' | 'stub';

// 工厂:按 env MODEL_PROVIDER 选 provider。只在 tool-use 可靠的 provider 间切换。
export async function createModelProvider(): Promise<ModelProvider> {
  const name = (process.env.MODEL_PROVIDER ?? 'anthropic') as ProviderName;
  switch (name) {
    case 'anthropic': {
      const { createAnthropicProvider } = await import('./anthropic');
      return createAnthropicProvider();
    }
    case 'openrouter': {
      const { createOpenRouterProvider } = await import('./openrouter');
      return createOpenRouterProvider();
    }
    case 'stub': {
      // 确定性 stub:离线跑 E2E 创作主路径用,不接任何真实模型。
      const { createStubProvider } = await import('./stub');
      return createStubProvider();
    }
    default:
      // 未知 provider 一律拒绝:绝不静默退回弱模型或文本解析路径。
      throw new Error(`未知或不被支持的 MODEL_PROVIDER: ${String(name)}`);
  }
}
