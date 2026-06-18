// 受保护路由组的布局:在屏幕挂载前做会话门控(ADR-0004)。
// 判断放在 group 的 layout 而非 effect——无会话时这里直接 <Redirect>,组内屏
// (index / chat / history / works)根本不挂载,避免它们在重定向前先发 agent / Supabase
// 请求(Codex P2 的 mount race)。根 Stack 已挂载,故这里的 <Redirect> 安全。

import { Redirect, Stack } from 'expo-router';
import { DEV_NO_AUTH, useAuth } from '../../src/auth';
import { defaultTheme, fonts } from '../../src/theme';

export default function ProtectedLayout() {
  const { session } = useAuth();

  // DEV_NO_AUTH(本地只做 UI/agent、完全不碰 Supabase)下不拦截。
  if (!session && !DEV_NO_AUTH) {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: defaultTheme.palette.pageBg },
        headerTintColor: defaultTheme.palette.textPrimary,
        headerTitleAlign: 'center',
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.serifTitle, fontWeight: '600' },
        contentStyle: { backgroundColor: defaultTheme.palette.pageBg },
      }}
    >
      <Stack.Screen name="index" options={{ title: '芯' }} />
      {/* 对话屏自带定制顶栏(返回 + 标题/阶段 + 文档),隐藏原生 Stack 顶栏。 */}
      <Stack.Screen name="chat" options={{ headerShown: false }} />
      <Stack.Screen name="history" options={{ title: '历史会话' }} />
      <Stack.Screen name="works" options={{ title: '作品' }} />
    </Stack>
  );
}
