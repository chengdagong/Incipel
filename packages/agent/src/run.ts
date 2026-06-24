// AG-UI run 编排(见 system-design §6.2)。一轮的时序:
//   RUN_STARTED{threadId,runId}
//   →(新连接)STATE_SNAPSHOT{snapshot: 当前剧本}
//   → provider.streamTurn:
//       · 文本增量        → TEXT_MESSAGE_START/CONTENT/END(流式模型文本)
//       · 每次内部工具调用 → 经 apply.ts 服务端执行 → 发一条 STATE_DELTA{delta}
//       · propose_options  → 收集为本轮 options(轮末发一条 CUSTOM options)
//   → 经 save_turn 写入数据库(有改动才写 version)
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
  type Screenplay,
} from '@incipel/shared';
import { nanoid } from 'nanoid';
import { applyToolCall } from './apply.ts';
import { createModelProvider } from './model/provider.ts';
import type { ModelProvider, StreamChunk } from './model/provider.ts';
import { buildPrompt } from './prompt.ts';
import { createStore, type Store } from './store.ts';

export type RunInput = {
  // threadId 即会话标识(等同 session id)。
  threadId: string;
  runId: string;
  userId: string;
  userMessage: string;
  // 是否新连接:为真时在 RUN_STARTED 后补发 STATE_SNAPSHOT 基线。
  newConnection: boolean;
  // 助手显示名;缺省「主管编剧」。为日后「用户自定义助手名」预留:由调用方按会话/用户传入。
  assistantName?: string;
};

// 核心循环的依赖(seam)。缺省时各自走线上默认实现。
export type RunDeps = {
  provider?: ModelProvider;
  store?: Store;
};

// 把一轮编排成一个 BaseEvent 异步序列。调用方(app.ts 的 /run handler)逐个 sse() 写进 SSE 响应。
// provider / store 可注入,便于冒烟脚本用内存 store + 真实 provider 跑同一条核心循环。
export async function* runTurnCore(input: RunInput, deps: RunDeps = {}): AsyncGenerator<BaseEvent> {
  const { threadId, runId } = input;
  const store = deps.store ?? createStore();

  yield ev({ type: EventType.RUN_STARTED, threadId, runId });

  // 载入权威剧本与完整对话历史(以 DB 为准,不信任 input.state)。失败直接 RUN_ERROR(无内容可编造)。
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

  // 幂等重放(见 docs/known-issues.md KI-2 / Codex 评审 P1):若该 runId 已写入数据库(首次请求已提交、
  // 但客户端没收到 RUN_FINISHED 就重发),不再调用模型——当前 documents.state 已含该轮改动(上面的
  // STATE_SNAPSHOT 已发),只补发已写入数据库的助手文本与本轮 options 后结束。否则会二次跑模型、向客户端
  // 流式一份随后被 save_turn 去重丢弃的新回复,造成客户端与库分叉并多花一次模型调用。
  let saved: Awaited<ReturnType<typeof store.findSavedTurn>> = null;
  try {
    saved = await store.findSavedTurn(threadId, input.runId);
  } catch {
    saved = null; // 查询失败不阻断,退回正常生成路径
  }
  if (saved) {
    if (!input.newConnection) {
      yield ev({ type: EventType.STATE_SNAPSHOT, snapshot: state });
    }
    if (saved.assistantText) {
      const replayId = nanoid();
      yield ev({ type: EventType.TEXT_MESSAGE_START, messageId: replayId, role: 'assistant' });
      yield ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: replayId, delta: saved.assistantText });
      yield ev({ type: EventType.TEXT_MESSAGE_END, messageId: replayId });
    }
    if (saved.options.length) {
      yield optionsEvent(saved.options);
    }
    yield ev({ type: EventType.RUN_FINISHED, threadId, runId });
    return;
  }

  const { system, prompt } = buildPrompt({
    state,
    history: loaded.history,
    userMessage: input.userMessage,
    assistantName: input.assistantName,
  });
  // 工具 schema 按当前状态生成:含 update_*/remove_* 的 id 枚举门控。
  const tools = buildToolSchemas(idSetsOf(state));

  const provider = deps.provider ?? (await createModelProvider());

  // 一轮的最终产物(取自成功的那次尝试),供轮末 save_turn 写入数据库与 options 事件。
  let committedState: Screenplay = state;
  let deltas: JsonPatchOp[] = [];
  let options: string[] = [];
  let assistantText = '';
  let changed = false;

  // 文本段在整轮内用同一 messageId,轮末只发唯一一条 TEXT_MESSAGE_END。失败尝试若已吐过文本,
  // 不单独补 END、也不换新 messageId——否则客户端会把残文定稿成另一条消息,多出一条重复气泡
  // 且与写入数据库分叉(见 docs/known-issues.md KI-1)。同一 messageId 下续写,客户端以最终写入数据库文本为准。
  const messageId = nanoid();
  let textStarted = false;

  // 每次尝试相互隔离(见 KI-1):
  //  · 从干净的 loaded.state 克隆起跑,仅当本次整段跑完才把克隆提交为正式剧本——失败尝试
  //    已 apply 的工具调用不会残留到下一尝试(否则会重复新建实体并写进权威 documents.state)。
  //  · 失败需重试时,先补发一条干净基线的 STATE_SNAPSHOT,让客户端退回失败尝试已应用的
  //    STATE_DELTA,再由下一尝试重发。
  //  · 事件仍即时外发以保留打字机式流式;纠偏只发生在(少见的)失败重试路径上。
  const maxAttempts = 2;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptState: Screenplay = structuredClone(state);
    const attemptDeltas: JsonPatchOp[] = [];
    let attemptOptions: string[] = [];
    let attemptText = '';
    let attemptChanged = false;

    try {
      yield* streamOnce(provider, { system, prompt, tools }, attemptState, {
        messageId,
        onText: (delta) => {
          attemptText += delta;
        },
        markTextStarted: () => {
          const first = !textStarted;
          textStarted = true;
          return first;
        },
        onDelta: (patch) => {
          attemptDeltas.push(...patch);
          attemptChanged = true;
        },
        onOptions: (opts) => {
          attemptOptions = opts;
        },
      });
      // 本次尝试整段成功:把克隆提交为正式产物。
      committedState = attemptState;
      deltas = attemptDeltas;
      options = attemptOptions;
      assistantText = attemptText;
      changed = attemptChanged;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        // 用干净基线纠偏:客户端据此退回失败尝试已应用的 STATE_DELTA,下一尝试从头重来。
        yield ev({ type: EventType.STATE_SNAPSHOT, snapshot: state });
        continue;
      }
    }
  }

  if (lastErr) {
    // 文本段收尾:整轮唯一一条 END(失败尝试不单独定稿,避免重复气泡)。
    if (textStarted) {
      yield ev({ type: EventType.TEXT_MESSAGE_END, messageId });
    }
    yield ev({
      type: EventType.RUN_ERROR,
      message: `模型调用失败: ${(lastErr as Error).message}`,
      code: 'MODEL_FAILED',
    });
    return;
  }

  if (!assistantText.trim() && changed) {
    const summary = fallbackAssistantText(committedState);
    if (summary) {
      assistantText = summary;
      if (!textStarted) {
        yield ev({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
        textStarted = true;
      }
      yield ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: summary });
    }
  }

  // 文本段收尾:整轮唯一一条 END(失败尝试不单独定稿,避免重复气泡)。
  if (textStarted) {
    yield ev({ type: EventType.TEXT_MESSAGE_END, messageId });
  }

  // 本轮可点选项(瞬时,不入剧本)。CUSTOM{name:'options'}。
  if (options.length) {
    yield optionsEvent(options);
  }

  // 轮末原子写入数据库:user/assistant messages + documents.state + sessions.updated_at,
  // 有改动再写 document_versions。runId 作幂等键:重发同一轮不重复写入数据库(见 KI-2)。
  try {
    await store.saveTurn({
      threadId,
      runId: input.runId,
      userText: input.userMessage,
      assistantText,
      deltas,
      options,
      state: committedState,
      changed,
    });
  } catch (err) {
    yield ev({
      type: EventType.RUN_ERROR,
      message: `写入数据库失败: ${(err as Error).message}`,
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

function fallbackAssistantText(state: Screenplay): string {
  const title = compactText(state.meta.title);
  const logline = compactText(state.meta.logline);
  const lines: string[] = [];

  if (title) {
    lines.push(`《${title}》`);
  }
  if (logline) {
    lines.push(logline);
  }

  const world = state.world
    .map((section) => compactText(section.title) || compactText(section.text))
    .filter(Boolean)
    .slice(0, 2);
  if (world.length) {
    lines.push(`世界观:${world.join('、')}`);
  }

  const characters = state.characters
    .map((character) => compactText(character.name) || compactText(character.role))
    .filter(Boolean)
    .slice(0, 3);
  if (characters.length) {
    lines.push(`人物:${characters.join('、')}`);
  }

  const outline = state.outline
    .map((act) => compactText(act.act) || compactText(act.beat))
    .filter(Boolean)
    .slice(0, 2);
  if (outline.length) {
    lines.push(`大纲:${outline.join('、')}`);
  }

  const scenes = state.scenes
    .map((scene) => compactText(scene.slug) || compactText(scene.content))
    .filter(Boolean)
    .slice(0, 2);
  if (scenes.length) {
    lines.push(`分场:${scenes.join('、')}`);
  }

  return lines.join('\n').trim() || '这轮更新了剧本草稿。';
}

function compactText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

// AG-UI 事件以普通对象发出(见 building-agents.md);BaseEvent 是 @ag-ui/core 的严格判别联合,
// 这里集中做一次到 BaseEvent 的窄化转换,避免在每个 yield 处散落断言。
function ev(event: Record<string, unknown>): BaseEvent {
  return event as unknown as BaseEvent;
}
