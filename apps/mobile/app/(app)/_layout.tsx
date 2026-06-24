// 受保护路由组的布局:在屏幕挂载前做会话门控(ADR-0005)。
// 判断放在 group 的 layout 而非 effect——无会话时这里直接 <Redirect>,组内屏
// (index / chat / history / works)根本不挂载,避免它们在重定向前先发 agent / Supabase
// 请求(Codex P2 的 mount race)。根 Stack 已挂载,故这里的 <Redirect> 安全。

import { Redirect, Stack } from 'expo-router';
import { DEV_NO_AUTH, useAuth } from '../../src/auth';
import { DrawerProvider } from '../../src/drawer/DrawerProvider';
import { defaultTheme, fonts } from '../../src/theme';

export default function ProtectedLayout() {
  const { session } = useAuth();

  // DEV_NO_AUTH(本地只做 UI/agent、完全不碰 Supabase)下不拦截。
  if (!session && !DEV_NO_AUTH) {
    return <Redirect href="/login" />;
  }

  // DrawerProvider 把侧边抽屉浮层挂在受保护区的 Stack 之上(任意屏 useDrawer().open());
  // history / works 的标题由各屏自设(t(),随语言切换),此处为初始/备用;settings、index 自带顶栏。
  return (
    <DrawerProvider>
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
        {/* 各屏均自带页内定制顶栏(对齐 handoff 原型),统一隐藏原生 Stack 顶栏。 */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        <Stack.Screen name="history" options={{ headerShown: false }} />
        <Stack.Screen name="works" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
      </Stack>
    </DrawerProvider>
  );
}
