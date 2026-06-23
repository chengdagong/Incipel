// 基于 Vercel AI SDK(ai)的 ModelProvider 通用实现。
//
// Anthropic 与 OpenRouter 的 provider 仅在「如何拿到一个 LanguageModelV1」上不同;一轮的
// 流式编排(streamText → fullStream → StreamChunk)与 logline 补全完全一致,集中在此,避免
// 各 provider 复制同一段逻辑。两个 provider 都满足 ADR-0001「只接 tool-use 可靠的 provider」。
//
// 工具集来自 @incipel/shared 的 buildToolSchemas(idSetsOf(state)):工具名 -> Zod 参数 schema
//(含 update_*/remove_* 的 id 枚举门控)。这里用 ai 的 tool() 把它们包成 streamText 的 tools。
// 工具带一个 ack-only execute + maxSteps:开启 SDK 多步,使模型在调完工具后再产出总结文本;
// 改剧本仍由 src/apply.ts 在 run 编排里完成(execute 不碰剧本,避免重复应用)。
// 背景:单步时模型可能纯调工具、不产任何文本(finishReason: tool-calls),聊天里就是空回复;
// 多步是 Vercel AI SDK 对此的标准解——见 vercel/ai#8738、loop-control 文档。

import { streamText, tool, type CoreTool, type LanguageModelV1, type ProviderMetadata } from 'ai';
import type { z } from 'zod';
import type {
  CompleteLoglineInput,
  ModelProvider,
  StreamChunk,
  StreamTurnInput,
} from './provider.ts';

// 由具体 provider 提供:按用途取一个 LanguageModelV1。
//  - 'turn'    每轮对话的强模型(tool-use 可靠)。
//  - 'logline' /logline 端点的便宜小模型。
export type ModelKind = 'turn' | 'logline';
export type ResolvedModel = {
  model: LanguageModelV1;
  temperature?: number;
  providerOptions?: ProviderMetadata;
};
export type ModelResolver = (kind: ModelKind) => ResolvedModel;

// 一轮允许的最大步数。第 1 步模型调工具,工具(ack)执行后第 2 步产出总结文本;
// 给足余量以容纳模型分几步写内容,但有上界以防它一直调工具不收尾。
const MAX_TURN_STEPS = 8;

// 用一个 ModelResolver 拼出符合 ModelProvider 接口的实现。
export function makeAiSdkProvider(resolve: ModelResolver): ModelProvider {
  return {
    async *streamTurn(input: StreamTurnInput): AsyncIterable<StreamChunk> {
      const resolved = resolve('turn');
      const result = streamText({
        model: resolved.model,
        // system 走 prompt caching;稳定的 system 命中缓存(见 prompt.ts)。
        system: input.system,
        prompt: input.prompt,
        tools: toCoreTools(input.tools),
        toolChoice: 'auto',
        temperature: resolved.temperature,
        providerOptions: resolved.providerOptions,
        // 多步:工具带 ack execute(见 toCoreTools),模型调完工具后 SDK 带着结果再生成一步——
        // 这一步才产出给用户的总结文本。单步会停在 finishReason: tool-calls、无 text。
        maxSteps: MAX_TURN_STEPS,
      });

      // fullStream 把文本增量与工具调用交错产出。
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { type: 'text', delta: part.textDelta };
            break;
          case 'tool-call-streaming-start':
            yield {
              type: 'tool-call-start',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            };
            break;
          case 'tool-call':
            yield {
              type: 'tool-call',
              call: {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                // ai SDK 已按对应 Zod schema 解析校验过 args。
                args: part.args,
              },
            };
            break;
          case 'error':
            // 把模型/传输错误抛出,交给 run.ts 的重试与 RUN_ERROR 处理。
            throw part.error instanceof Error ? part.error : new Error(String(part.error));
          default:
            // 其余事件(step-start/finish 等)本轮不消费。
            break;
        }
      }
    },

    async completeLogline(input: CompleteLoglineInput): Promise<string> {
      const resolved = resolve('logline');
      const result = streamText({
        model: resolved.model,
        system: input.system,
        prompt: input.prompt,
        temperature: resolved.temperature,
        providerOptions: resolved.providerOptions,
      });
      let text = '';
      for await (const delta of result.textStream) {
        text += delta;
      }
      return text.trim();
    },
  };
}

// 把 buildToolSchemas 的 (name -> Zod schema) 转成 ai 的 tools。
// 不提供 execute:工具调用由 src/run.ts 经 src/apply.ts 应用到剧本,这层只透传。
function toCoreTools(schemas: Record<string, z.ZodTypeAny>): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    tools[name] = tool({
      // 工具的语义在 SYSTEM 提示里说明;此处 description 留空即可。
      parameters: schema,
      // ack-only:不在此应用剧本(那在 run.ts 消费 tool-call 时做);仅为开启多步,
      // 让模型拿到工具结果后继续产出总结文本。
      execute: async () => ({ ok: true }),
    });
  }
  return tools;
}
