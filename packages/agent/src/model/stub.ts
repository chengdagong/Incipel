// 确定性 stub provider(仅本地 / E2E 用,prod 永不设 MODEL_PROVIDER=stub)。
//
// 目的:让 Maestro 的「创作主路径」E2E 离线、可重复地跑——不花 token、不靠网络、每次产出一致。
// 工厂 createModelProvider() 在 MODEL_PROVIDER=stub 时返回它;与 anthropic/openrouter 走同一条
// 核心循环(run.ts 的 runTurnCore),只是把「真实模型流」换成一段写死的脚本(给罐头答案=stub)。
//
// 与真实路径对齐的两点:
// 1) 文本与 tool-call 交错产出,形状与 ai-sdk-runtime 完全一致(见 model/provider.ts 的 StreamChunk)。
// 2) tool-call 的 args 先过该工具当轮的 Zod schema 校验再产出——真实 ai-sdk 给到的 args 也是「已按
//    schema 解析」的(见 provider.ts:9 注释)。这样 E2E 跑通即意味着参数形状没偏离真实路径;
//    某工具当轮未被提供(被 buildToolSchemas 的 id 门控挡掉)时跳过它,等同真实「只能调被提供的工具」。

import type {
  CompleteLoglineInput,
  ModelProvider,
  StreamChunk,
  StreamTurnInput,
} from './provider';

// 一段写死的一轮:先两段文字,再用三个工具立起开头——设标题/logline、建一个核心人物、给两个走向。
// 文案刻意具体(人物名「林夏」),便于 Maestro 用可见文本做断言锚点。
const SCRIPTED_TEXT = ['我先把这个开头立起来——', '给你标题、一句 logline,再搭一个核心人物。'];

// [toolCallId, toolName, 原始参数];原始参数会先过 input.tools[name] 的 schema 校验。
const SCRIPTED_TOOLS: ReadonlyArray<readonly [string, string, unknown]> = [
  [
    'stub-meta',
    'set_meta',
    { title: '深夜来电', logline: '一个钟点工每晚接到十年前自己的来电。' },
  ],
  [
    'stub-char',
    'add_character',
    {
      name: '林夏',
      role: '钟点工',
      attrs: [
        { label: '外貌', value: '清瘦,眼神疲惫' },
        { label: '处境', value: '独居,靠夜班为生' },
      ],
    },
  ],
  ['stub-options', 'propose_options', { options: ['先挖她的过去', '让电话那头先开口'] }],
];

export function createStubProvider(): ModelProvider {
  return {
    async *streamTurn(input: StreamTurnInput): AsyncIterable<StreamChunk> {
      for (const delta of SCRIPTED_TEXT) {
        yield { type: 'text', delta };
      }
      for (const [toolCallId, toolName, raw] of SCRIPTED_TOOLS) {
        const schema = input.tools[toolName];
        // 该工具当轮未被提供(被 id 门控挡掉)→ 跳过,等同真实模型只能调被提供的工具。
        if (!schema) continue;
        // 过当轮 schema 校验,产出与真实路径一致的「已解析参数」。
        const args = schema.parse(raw);
        yield { type: 'tool-call', call: { toolCallId, toolName, args } };
      }
    },
    // 欢迎页骰子(/logline)用:返回一句固定 logline,离线可用。
    async completeLogline(_input: CompleteLoglineInput): Promise<string> {
      return '一个深夜便利店店员,发现每位顾客都在重复同一天。';
    },
  };
}
