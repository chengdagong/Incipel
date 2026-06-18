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
} from '@incipel/shared';
import { getAccessToken } from '../supabase';

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
export function useScreenplayAgent(threadId: string): ScreenplayAgentApi {
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
        setError(null);
        setStreamingText('');
        setOptions([]); // 新一轮清空上一轮的瞬时选项
      },
      // 流式文本:SDK 给出累计 buffer,直接用作当前打字气泡内容。
      onTextMessageContentEvent: ({ textMessageBuffer, event }) => {
        setStreamingText(textMessageBuffer + event.delta);
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
        pendingRunIdRef.current = null; // 本轮已落库,runId 使命结束
        syncFromAgent();
      },
      onRunErrorEvent: ({ event }) => {
        setIsRunning(false);
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

  // 用指定 runId 跑一轮;捕获未走事件通道的异常(SDK 通常会转成 RUN_ERROR),避免 UI 卡在 running。
  const runWith = useCallback(async (runId: string) => {
    const agent = agentRef.current!;
    if (agent.isRunning) return; // 一轮未结束不并发下一轮
    try {
      await agent.runAgent({ runId }, undefined);
    } catch (e) {
      setIsRunning(false);
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

  return { messages, screenplay, streamingText, options, isRunning, error, sendMessage, retry };
}
