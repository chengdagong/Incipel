// 可编程的确定性 stub ModelProvider:按脚本产出 StreamChunk,供离线跑 runTurnCore(见 testing-strategy §5)。
// 每次 streamTurn 调用消费一个脚本;脚本里遇到 'throw' 步骤即抛错(用于触发重试路径)。
// 调用次数超过脚本数时沿用最后一个脚本,便于「每次都成功」的场景。
//
// 与 src/model/stub.ts 区别:那一份是 MODEL_PROVIDER=stub 时工厂返回的、回放写死一轮的 provider;
// 这一份是单测里按脚本组装任意序列(含抛错)的 helper。两者都是「给罐头答案」的 stub。

import type {
  CompleteLoglineInput,
  ModelProvider,
  StreamChunk,
  StreamTurnInput,
} from '../../src/model/provider';

export type StubStep = StreamChunk | { type: 'throw'; message?: string };

export function throwStep(message?: string): StubStep {
  return { type: 'throw', message };
}

export function stubProvider(scripts: StubStep[][]): ModelProvider {
  let call = 0;
  return {
    async *streamTurn(_input: StreamTurnInput): AsyncIterable<StreamChunk> {
      const idx = Math.min(call, scripts.length - 1);
      call += 1;
      const script = scripts[idx] ?? [];
      for (const step of script) {
        if (step.type === 'throw') throw new Error(step.message ?? 'stub stream error');
        yield step;
      }
    },
    async completeLogline(_input: CompleteLoglineInput): Promise<string> {
      return '一句测试 logline';
    },
  };
}
