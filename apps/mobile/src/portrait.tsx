// 人物肖像(issue #14):客户端状态 + 生成弹窗的开合 + 提示词拼接 + 占位色。
//
// 重要边界(见 system-design §15 与肖像规格):
// - 真实图像生成在 v1 之外;本轮只做**交互 + 占位**——「生成」走本地定时器,落到「占位色 + 名字首字」。
// - 肖像是**客户端状态**(按 character.id 维护),**不进 Screenplay 契约**、不落库、不导出。
// - 切换会话时本状态自然随 chat 屏重挂而清空(不持久化)。
//
// 无 react-native-svg / expo-linear-gradient:占位底用纯 HSL 单色(由人物名确定,同名同色)。

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { Character } from '@incipel/shared';

export type PortraitStyle = 'cinematic' | 'illustration' | 'lineart' | 'watercolor';
export type PortraitStatus = 'empty' | 'loading' | 'done';

export type Portrait = { status: PortraitStatus; style: PortraitStyle };

// 「生成」占位耗时(模拟,真实生图在 v1 之外)。
const FAKE_GEN_MS = 1700;
const DEFAULT_STYLE: PortraitStyle = 'cinematic';

// 名字 → 色相(0–359),确定性:同名同色。
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

// 占位底色(纯 HSL 单色,RN 接受 hsl() 字符串)。lineart 走中性灰,不随色相变。
export function portraitColor(name: string, style: PortraitStyle): string {
  const h = hueOf(name || '?');
  switch (style) {
    case 'illustration':
      return `hsl(${h}, 46%, 60%)`;
    case 'lineart':
      return '#9B948A';
    case 'watercolor':
      return `hsl(${(h + 40) % 360}, 48%, 62%)`;
    case 'cinematic':
    default:
      return `hsl(${h}, 40%, 42%)`;
  }
}

// 取人物某条属性值(按 label 精确匹配,找不到返回空串)。
function attr(c: Character, label: string): string {
  return c.attrs.find((a) => a.label === label)?.value ?? '';
}

// 由人物 外貌 + 性格(并纳入 年龄/性别/角色)拼出提示词(肖像规格「四、提示词拼接」)。
// 真实生图在 v1 之外;此提示词只在弹窗内展示/编辑,不持久化。
export function buildPortraitPrompt(c: Character): string {
  const bits: string[] = [];
  const age = attr(c, '年龄');
  if (age) bits.push(age);
  const sex = attr(c, '性别');
  if (sex) bits.push(sex === '女' ? '女性' : sex === '男' ? '男性' : sex);
  if (c.role) bits.push(c.role);
  const look = attr(c, '外貌');
  if (look) bits.push(look);
  const personality = attr(c, '性格');
  if (personality) bits.push(`${personality}的气质`);
  const s = bits.join('，');
  return (s ? `${s}；` : '') + '浅景深半身肖像。';
}

type PortraitApi = {
  // 各人物的肖像状态(无条目即视为 empty)。
  statusOf: (characterId: string) => Portrait;
  // 弹窗当前聚焦的人物(null = 未打开)。
  sheetChar: Character | null;
  openSheet: (c: Character) => void;
  closeSheet: () => void;
  // 确认生成:置 loading,FAKE_GEN_MS 后置 done(占位)。
  generate: (characterId: string, style: PortraitStyle) => void;
};

const EMPTY: Portrait = { status: 'empty', style: DEFAULT_STYLE };
const PortraitContext = createContext<PortraitApi | null>(null);

export function PortraitProvider({ children }: { children: React.ReactNode }) {
  const [portraits, setPortraits] = useState<Record<string, Portrait>>({});
  const [sheetChar, setSheetChar] = useState<Character | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const statusOf = useCallback((id: string): Portrait => portraits[id] ?? EMPTY, [portraits]);
  const openSheet = useCallback((c: Character) => setSheetChar(c), []);
  const closeSheet = useCallback(() => setSheetChar(null), []);

  const generate = useCallback((id: string, style: PortraitStyle) => {
    // 清掉该人物上一个未完成的定时器,避免竞态。
    if (timers.current[id]) clearTimeout(timers.current[id]);
    setSheetChar(null);
    setPortraits((prev) => ({ ...prev, [id]: { status: 'loading', style } }));
    timers.current[id] = setTimeout(() => {
      setPortraits((prev) => ({ ...prev, [id]: { status: 'done', style } }));
      delete timers.current[id];
    }, FAKE_GEN_MS);
  }, []);

  const api = useMemo<PortraitApi>(
    () => ({ statusOf, sheetChar, openSheet, closeSheet, generate }),
    [statusOf, sheetChar, openSheet, closeSheet, generate],
  );
  return <PortraitContext.Provider value={api}>{children}</PortraitContext.Provider>;
}

export function usePortrait(): PortraitApi {
  const ctx = useContext(PortraitContext);
  if (!ctx) throw new Error('usePortrait 必须在 PortraitProvider 内使用');
  return ctx;
}
