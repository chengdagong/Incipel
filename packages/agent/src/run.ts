// AG-UI run 编排(见 system-design §6.2)。一轮的时序:
//   RUN_STARTED{threadId,runId}
//   →(新连接)STATE_SNAPSHOT{snapshot: 当前剧本}
//   → provider.streamTurn:
//       · 文本增量        → TEXT_MESSAGE_START/CONTENT/END(流式模型文本)
//       · 每次内部工具调用 → 经 apply.ts 服务端执行 → 发一条 STATE_DELTA{delta}
//       · propose_options  → 收集为本轮 options(轮末发一条 CUSTOM options)
//   → 经 save_turn 落库(有改动才写 version)
//   → RUN_FINISHED{threadId,runId}
// 模型调用失败重试一次,仍失败发 RUN_ERROR{message,code}(不编造内容)。
//
// 重要:add_character 等是「内部工具」,由服务端执行——模型调用后我们 apply 并发 STATE_DELTA,
// 不发 TOOL_CALL_* 让前端去执行(那是 frontend tool 的流程,不适用)。
//
// 核心循环 runTurnCore 注入 { provider, store }(seam):/run 与冒烟脚本共用它。

import {
  buildToolSchemas,
  EventType,
  idSetsOf,
  optionsEvent,
  type BaseEvent,
  type JsonPatchOp,
} from '@incipel/shared';
import { nanoid } from 'nanoid';
import { applyToolCall } from './apply';
import { createModelProvider } from './model/provider';
import type { ModelProvider, StreamChunk } from './model/provider';
import { buildPrompt } from './prompt';
import { createStore, type Store } from './store';

export type RunInput = {
  // threadId 即会话标识(等同 session id)。
  threadId: string;
  runId: string;
  userId: string;
  userMessage: string;
  // 是否新连接:为真时在 RUN_STARTED 后补发 STATE_SNAPSHOT 基线。
  newConnection: boolean;
};

// 核心循环的依赖(seam)。缺省时各自走线上默认实现。
export type RunDeps = {
  provider?: ModelProvider;
  store?: Store;
};

// 把一轮编排成一个 BaseEvent 异步序列。调用方(index.ts)逐个 sse() 写进 SSE 响应。
// provider / store 可注入,便于冒烟脚本用内存 store + 真实 provider 跑同一条核心循环。
export async function* runTurnCore(input: RunInput, deps: RunDeps = {}): AsyncGenerator<BaseEvent> {
  const { threadId, runId } = input;
  const store = deps.store ?? createStore();

  yield ev({ type: EventType.RUN_STARTED, threadId, runId });

  // 载入权威剧本与最近对话(以 DB 为准,不信任 input.state)。失败直接 RUN_ERROR(无内容可编造)。
  let loaded;
  try {
    loaded = await store.loadSession(threadId, input.userId);
  } catch (err) {
    yield ev({
      type: EventType.RUN_ERROR,
      message: `加载会话失败: ${(err as Error).message}`,
      code: 'LOAD_FAILED',
    });
    return;
  }

  const state = loaded.state;
  if (input.newConnection) {
    yield ev({ type: EventType.STATE_SNAPSHOT, snapshot: state });
  }

  const { system, prompt } = buildPrompt({
    state,
    recent: loaded.recent,
    userMessage: input.userMessage,
  });
  // 工具 schema 按当前状态生成:含 update_*/remove_* 的 id 枚举门控。
  const tools = buildToolSchemas(idSetsOf(state));

  const provider = deps.provider ?? (await createModelProvider());

  // 累积一轮的产物,供轮末 save_turn 落库与 options 事件。
  const deltas: JsonPatchOp[] = [];
  let options: string[] = [];
  let assistantText = '';
  let changed = false;

  const messageId = nanoid();
  let textStarted = false;

  // streamTurn 包一层重试:整段流要么成功跑完,要么抛错由外层重试。
  // 注意:重试会重跑模型,但本轮尚未落库,且每次重试都从干净状态重新累积。
  const maxAttempts = 2;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 每次尝试前清空累积(上次失败可能已部分填充)。
    deltas.length = 0;
    options = [];
    assistantText = '';
    changed = false;

    try {
      yield* streamOnce(provider, { system, prompt, tools }, state, {
        messageId,
        onText: (delta) => {
          assistantText += delta;
        },
        markTextStarted: () => {
          const first = !textStarted;
          textStarted = true;
          return first;
        },
        onDelta: (patch) => {
          deltas.push(...patch);
          changed = true;
        },
        onOptions: (opts) => {
          options = opts;
        },
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      // 失败后下一尝试沿用同一 messageId 继续累积(客户端以最终落库文本为准)。
      if (attempt < maxAttempts) continue;
    }
  }

  if (textStarted) {
    yield ev({ type: EventType.TEXT_MESSAGE_END, messageId });
  }

  if (lastErr) {
    yield ev({
      type: EventType.RUN_ERROR,
      message: `模型调用失败: ${(lastErr as Error).message}`,
      code: 'MODEL_FAILED',
    });
    return;
  }

  // 本轮可点选项(瞬时,不入剧本)。CUSTOM{name:'options'}。
  if (options.length) {
    yield optionsEvent(options);
  }

  // 轮末原子落库:user/assistant messages + documents.state + sessions.updated_at,
  // 有改动再写 document_versions。
  try {
    await store.saveTurn({
      threadId,
      userText: input.userMessage,
      assistantText,
      deltas,
      options,
      state,
      changed,
    });
  } catch (err) {
    yield ev({
      type: EventType.RUN_ERROR,
      message: `落库失败: ${(err as Error).message}`,
      code: 'PERSIST_FAILED',
    });
    return;
  }

  yield ev({ type: EventType.RUN_FINISHED, threadId, runId });
}

type StreamCallbacks = {
  messageId: string;
  onText: (delta: string) => void;
  // 返回是否是本轮第一段文本(用于发 TEXT_MESSAGE_START)。
  markTextStarted: () => boolean;
  onDelta: (patch: JsonPatchOp[]) => void;
  onOptions: (options: string[]) => void;
};

// 跑一次 streamTurn,把模型增量翻译成 AG-UI 事件并就地改剧本。任一处出错向上抛(供重试)。
async function* streamOnce(
  provider: ModelProvider,
  turnInput: Parameters<ModelProvider['streamTurn']>[0],
  state: Parameters<typeof applyToolCall>[2],
  cb: StreamCallbacks,
): AsyncGenerator<BaseEvent> {
  for await (const chunk of provider.streamTurn(turnInput) as AsyncIterable<StreamChunk>) {
    switch (chunk.type) {
      case 'text': {
        if (cb.markTextStarted()) {
          yield ev({ type: EventType.TEXT_MESSAGE_START, messageId: cb.messageId, role: 'assistant' });
        }
        cb.onText(chunk.delta);
        yield ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: cb.messageId, delta: chunk.delta });
        break;
      }
      // tool-call-start 不外发:内部工具由服务端执行,不走 TOOL_CALL_*(那是 frontend tool 的流程)。
      case 'tool-call-start':
        break;
      case 'tool-call': {
        const { toolName, args } = chunk.call;
        // propose_options 不改剧本:转成本轮 options。
        if (toolName === 'propose_options') {
          const opts = (args as { options?: unknown }).options;
          cb.onOptions(Array.isArray(opts) ? opts.map(String).slice(0, 3) : []);
          break;
        }
        // 其余工具服务端执行:apply 到内存剧本,发一条 STATE_DELTA。
        const result = applyToolCall(toolName, args, state);
        if (result.patch.length) {
          cb.onDelta(result.patch);
          yield ev({ type: EventType.STATE_DELTA, delta: result.patch });
        }
        break;
      }
    }
  }
}

// AG-UI 事件以普通对象发出(见 building-agents.md);BaseEvent 是 @ag-ui/core 的严格判别联合,
// 这里集中做一次到 BaseEvent 的窄化转换,避免在每个 yield 处散落断言。
function ev(event: Record<string, unknown>): BaseEvent {
  return event as unknown as BaseEvent;
}
