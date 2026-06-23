// AG-UI 连接(方案 B):用 @ag-ui/client 的 HttpAgent 直连我们的 AG-UI 端点。
// - HttpAgent.run() 向 `${EXPO_PUBLIC_AGENT_URL}/run` POST 一个 RunAgentInput,服务端 SSE 回事件;
//   事件应用、消息与状态维护由 SDK 内部完成(见 references/client-sdk.md)。
// - 请求头带 Supabase 匿名 JWT,agent 端据此校验归属(system-design §4)。
// - 共享状态(AG-UI 的 state)就是一份 Screenplay —— 类型只来自 @incipel/shared,不在客户端重定义。

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetch as expoFetch } from 'expo/fetch';
import {
  AbstractAgent,
  HttpAgent,
  type AgentSubscriber,
  randomUUID,
} from '@ag-ui/client';
import {
  type Message,
  type Screenplay,
  OPTIONS_EVENT_NAME,
  emptyScreenplay,
  normalizeScreenplay,
} from '@incipel/shared';
import { getAccessToken, supabase } from '../supabase';
import { orderStoredMessages, type StoredMessageRow } from './order-messages';

const AGENT_URL = process.env.EXPO_PUBLIC_AGENT_URL;

if (!AGENT_URL) {
  console.warn('[agui] 缺少 EXPO_PUBLIC_AGENT_URL,请参照 .env.example 配置。');
}

// AG-UI run 的端点:每轮一个 run,POST 发消息、SSE 流式回事件(system-design §6.2)。
export function runEndpoint(): string {
  return `${AGENT_URL ?? ''}/run`;
}

// /logline 端点:欢迎页 🎲 调用(便宜模型,一次性 completion,见 system-design §10)。
export function loglineEndpoint(): string {
  return `${AGENT_URL ?? ''}/logline`;
}

// 组装带匿名 JWT 的请求头;agent 端用它校验归属。
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// 客户端生成 threadId(= 会话 id):欢迎页开始创作时调一次,传给 chat 屏。
export function newThreadId(): string {
  return randomUUID();
}

// 续写已有会话时一次性恢复的历史消息上限。够展示近况;同时为续写时随 /run 回传的 messages
// 数组留出服务端上限余量(见 packages/agent/src/app.ts 的 MAX_MESSAGES / 请求体字节上限)。
// 注意:服务端只取 messages 里最后一条 user 文本,prompt 上下文另从数据库窗口重建,故回传历史
// 既不污染模型上下文,也只受这两条上限约束。
const MAX_HYDRATE_MESSAGES = 100;

/**
 * 打开已有会话时,直接从 Supabase 读它的权威剧本(documents.state)与历史消息(messages),
 * 用于在不触发模型调用、不发 /run 的前提下,把对话与文档面板恢复到界面上。
 *
 * 数据来源与抽屉 / 历史 / 作品屏一致:都用 supabase-js 直查、靠 RLS 按 user_id 归属隔离
 * (messages 的 SELECT 策略经 session 归属校验,见 supabase/migrations/0001_init.sql)。
 * 全新会话(threadId 尚未落库)查不到任何行,返回 null。
 */
export async function loadSessionSnapshot(
  threadId: string,
): Promise<{ state: Screenplay; messages: Message[] } | null> {
  const [docRes, msgRes] = await Promise.all([
    supabase.from('documents').select('state').eq('session_id', threadId).maybeSingle(),
    supabase
      .from('messages')
      .select('id, role, text, created_at')
      .eq('session_id', threadId)
      .order('created_at', { ascending: true })
      .limit(MAX_HYDRATE_MESSAGES),
  ]);
  if (docRes.error) console.warn('[agui] 读取会话剧本失败:', docRes.error.message);
  if (msgRes.error) console.warn('[agui] 读取会话消息失败:', msgRes.error.message);

  const rawState = (docRes.data?.state ?? null) as Screenplay | null;
  // 排序与同轮 user/assistant 次序的处理见 order-messages.ts(created_at 在同一轮里相等)。
  const messages = orderStoredMessages(
    (msgRes.data ?? []) as StoredMessageRow[],
  ) as unknown as Message[];

  if (!rawState && messages.length === 0) return null;
  // 归一旧结构(与服务端 store.loadSession 一致),避免残缺历史剧本让文档面板 / 卡片取属性而崩。
  return { state: normalizeScreenplay(rawState ?? emptyScreenplay()), messages };
}

/**
 * HttpAgent 工厂:每个 threadId 一个 agent。
 * 注意:HttpAgent 的 headers 在构造时固定;匿名 JWT 会刷新,所以这里覆盖 fetch,
 * 每次请求都重新取一遍 authHeaders()(token 过期场景见 system-design §4)。
 * 初始 state 给一份空剧本作基线;真正的基线由首轮的 STATE_SNAPSHOT 覆盖(system-design §6.2)。
 */
export function createScreenplayAgent(threadId: string): HttpAgent {
  return new HttpAgent({
    url: runEndpoint(),
    threadId,
    initialState: emptyScreenplay() as unknown as Record<string, unknown>,
    // 用 expo/fetch(SDK 52)而非 RN 全局 fetch:全局 fetch 的 response.body 不支持
    // getReader() 流式读取,@ag-ui/client 读 SSE 会报 "Failed to getReader() from response"。
    // 同时每轮请求前合并最新鉴权头。expo/fetch 与 DOM fetch 类型签名不同但运行时兼容,
    // 故此处用 any 跨过类型边界。
    fetch: (async (url: string, init: any) => {
      const headers = { ...(init?.headers ?? {}), ...(await authHeaders()) };
      return expoFetch(url, { ...init, headers });
    }) as any,
  });
}

// hook 暴露给屏幕的形状。
export type ScreenplayAgentApi = {
  messages: Message[];
  screenplay: Screenplay;
  streamingText: string; // 当前正在流式打字的 assistant 文本(本轮,未结束)
  options: string[]; // 本轮可点选项(CUSTOM name==="options");下一轮开始时清空
  isRunning: boolean;
  // 本轮已开始、首个 assistant token 未到(「思考中」三点用)。由 run 生命周期维护,
  // retry 不追加 user 消息时也准确(见 #42 Codex 评审 P3)。
  thinking: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  // 重试当前这一轮:沿用同一 runId,服务端据此幂等、不重复落库(见 KI-2)。
  // 失败后应调用它,而不是重新 sendMessage(后者会生成新 runId、绕开幂等键)。
  retry: () => Promise<void>;
};

/**
 * 薄 React hook:内部持有一个 HttpAgent,subscribe() 把 AG-UI 事件映射到 React state。
 * - onTextMessageContentEvent → 流式文本(streamingText)
 * - onStateSnapshotEvent / onStateDeltaEvent → 剧本(screenplay,直接读 agent.state)
 * - onCustomEvent(name==="options") → 本轮选项
 * - onRunStarted/Finished/ErrorEvent → 运行状态与错误
 * 消息历史与 state 的维护交给 SDK(defaultApplyEvents);hook 只做镜像同步。
 */
export function useScreenplayAgent(
  threadId: string,
  opts?: { hydrate?: boolean },
): ScreenplayAgentApi {
  // hydrate:打开已有会话(路由带 sessionId)时为真,挂载即从数据库恢复历史消息与剧本。
  // 新建创作(欢迎页带 idea 的全新 threadId)为假:无可恢复内容,免一次必空的查询。
  const hydrate = opts?.hydrate ?? false;

  // 每个 threadId 一个 agent 实例;threadId 变了就重建。
  const agentRef = useRef<HttpAgent | null>(null);
  if (agentRef.current === null || agentRef.current.threadId !== threadId) {
    agentRef.current = createScreenplayAgent(threadId);
  }

  const [messages, setMessages] = useState<Message[]>([]);
  const [screenplay, setScreenplay] = useState<Screenplay>(() => emptyScreenplay());
  const [streamingText, setStreamingText] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  // 本轮已开始、还没有任何 assistant 文本(等首 token)。不从 messages 推断:retry 不追加 user 消息,
  // 仅凭「末条是否用户消息」会误判,故由 run 生命周期事件直接维护(见 #42 Codex 评审 P3)。
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 一「逻辑轮」的 runId:重试沿用同一个,作 save_turn 的幂等键(见 KI-2)。完成后清空。
  const pendingRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const agent = agentRef.current!;

    // 从 agent 当前状态同步消息与剧本(state 即 Screenplay,见上)。
    const syncFromAgent = () => {
      setMessages([...agent.messages]);
      setScreenplay(agent.state as Screenplay);
    };

    const subscriber: AgentSubscriber = {
      onRunStartedEvent: () => {
        setIsRunning(true);
        setThinking(true); // 本轮开始,等首个 assistant token
        setError(null);
        setStreamingText('');
        setOptions([]); // 新一轮清空上一轮的瞬时选项
      },
      // 流式文本:SDK 给出累计 buffer,直接用作当前打字气泡内容。
      onTextMessageContentEvent: ({ textMessageBuffer, event }) => {
        setStreamingText(textMessageBuffer + event.delta);
        setThinking(false); // 首 token 已到,退出「思考中」(后续为同值 no-op)
      },
      onTextMessageEndEvent: () => {
        // 文本落定为一条 assistant 消息后,清空流式缓冲并同步消息列表。
        setStreamingText('');
        setMessages([...agent.messages]);
      },
      // 剧本:快照作基线、增量打补丁,二者 SDK 都已应用到 agent.state,这里直接镜像。
      onStateSnapshotEvent: () => {
        setScreenplay(agent.state as Screenplay);
      },
      onStateDeltaEvent: () => {
        setScreenplay(agent.state as Screenplay);
      },
      // 本项目用 CUSTOM { name: "options" } 承载本轮可点选项。
      onCustomEvent: ({ event }) => {
        if (event.name === OPTIONS_EVENT_NAME && Array.isArray(event.value)) {
          setOptions(event.value as string[]);
        }
      },
      onRunFinishedEvent: () => {
        setIsRunning(false);
        setThinking(false);
        pendingRunIdRef.current = null; // 本轮已落库,runId 使命结束
        syncFromAgent();
      },
      onRunErrorEvent: ({ event }) => {
        setIsRunning(false);
        setThinking(false);
        setError(event.message ?? '运行出错');
      },
      // SDK 主动通知的消息/状态变更(兜住非事件路径的更新)。
      onMessagesChanged: () => setMessages([...agent.messages]),
      onStateChanged: () => setScreenplay(agent.state as Screenplay),
    };

    const sub = agent.subscribe(subscriber);
    // 挂载时先镜像一次(续写场景:agent 可能已带 initialMessages/state)。
    syncFromAgent();
    return () => sub.unsubscribe();
  }, [threadId]);

  // 续写已有会话:挂载时直接从 Supabase 读该会话的历史消息与剧本,灌进 agent 实例,
  // 让对话与文档面板恢复显示(不发 /run、不触发模型调用)。仅在 agent 尚无消息、且未在运行时
  // 灌入,避免覆盖用户已开始的这一轮;全新会话查不到行(loadSessionSnapshot 返回 null),自然空操作。
  useEffect(() => {
    if (!hydrate) return;
    let alive = true;
    void (async () => {
      const snapshot = await loadSessionSnapshot(threadId);
      if (!alive || !snapshot) return;
      const agent = agentRef.current;
      if (!agent || agent.threadId !== threadId) return; // threadId 已切换,放弃这次恢复
      if (agent.messages.length > 0 || agent.isRunning) return; // 已有内容 / 正在运行,不覆盖
      // 先灌剧本再灌消息:即便两次 setState 未被批处理,messages 变非空时剧本也已是完整态,
      // chat.tsx 的「本轮新增」对比基线据此不会把既有实体误判为本轮新增(见 chat.tsx 的 reopen 基线)。
      agent.setState(snapshot.state as unknown as Record<string, unknown>);
      agent.setMessages(snapshot.messages);
      setScreenplay(agent.state as Screenplay);
      setMessages([...agent.messages]);
    })();
    return () => {
      alive = false;
    };
  }, [threadId, hydrate]);

  // 用指定 runId 跑一轮;捕获未走事件通道的异常(SDK 通常会转成 RUN_ERROR),避免 UI 卡在 running。
  const runWith = useCallback(async (runId: string) => {
    const agent = agentRef.current!;
    if (agent.isRunning) return; // 一轮未结束不并发下一轮
    try {
      await agent.runAgent({ runId }, undefined);
    } catch (e) {
      setIsRunning(false);
      setThinking(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 发消息 / 点选项:追加一条用户消息,为这一逻辑轮生成稳定 runId,触发一次 run(system-design §6.2 / §10)。
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const agent = agentRef.current!;
      if (agent.isRunning) return;

      // 追加用户消息;乐观更新一次列表,随后由 run 的事件继续维护。
      agent.addMessage({ id: randomUUID(), role: 'user', content: trimmed } as Message);
      setMessages([...agent.messages]);

      const runId = randomUUID();
      pendingRunIdRef.current = runId;
      await runWith(runId);
    },
    [runWith],
  );

  // 重试当前这一轮:沿用同一 runId、不再追加用户消息。服务端据此幂等,重发不重复落库(见 KI-2)。
  const retry = useCallback(async () => {
    const runId = pendingRunIdRef.current;
    if (!runId) return;
    await runWith(runId);
  }, [runWith]);

  return { messages, screenplay, streamingText, options, isRunning, thinking, error, sendMessage, retry };
}
