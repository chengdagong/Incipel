// 会话状态的单一来源:启动只读现有会话(getExistingSession),并订阅 supabase 的鉴权变化。
// 路由据此集中门控(ADR-0005,见 app/_layout.tsx 的 effect):无会话 → 登录页,有会话 → 创作页;
// 登录页点 Apple / 先随便逛逛成功后,onAuthStateChange 推来新会话,门控自动把人放进去。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getExistingSession, supabase } from './supabase';

// 本地开发开关:置 1 时跳过登录门、不需要 Supabase 会话(对应 agent 的 DEV_NO_AUTH/STORE=memory,
// 见 CLAUDE.md「只做 UI/agent 逻辑、完全不碰 Supabase」)。生产默认关闭。
export const DEV_NO_AUTH = process.env.EXPO_PUBLIC_DEV_NO_AUTH === '1';

type AuthState = {
  session: Session | null;
  // 首次会话读取是否完成。未完成时根布局显示加载态,避免登录页与创作页之间闪一下。
  ready: boolean;
};

const AuthContext = createContext<AuthState>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    // 启动只读、不创建。Supabase 不可达时返回 null,落到登录页,不阻塞启动。
    getExistingSession()
      .then((s) => {
        if (mounted) setSession(s);
      })
      .catch(() => {
        // 读会话失败按「无会话」处理,显示登录页。
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    // 之后的登录 / 登出 / token 刷新都经此推送,保持 session 与 supabase 一致。
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, ready }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
