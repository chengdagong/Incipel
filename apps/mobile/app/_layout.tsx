// 根布局。
// 顶部必须先装 polyfill:Hermes 缺一批 Web API,supabase-js 与 @ag-ui/client(SSE 流式)都依赖它们
// (见 system-design §13「RN 包较新,有坑(Hermes polyfill…)」)。务必排在所有业务 import 之前。
// 平台差异封装在 ../src/polyfills 里(原生装 polyfill;web 走 polyfills.web.ts 空实现)。
import '../src/polyfills';

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, DEV_NO_AUTH, useAuth } from '../src/auth';
import { useAppFonts } from '../src/useAppFonts';
import { defaultTheme, fonts } from '../src/theme';

export default function RootLayout() {
  // 会话状态在 AuthProvider 内维护;启动只读、不自动建会话(ADR-0004)。
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session, ready: authReady } = useAuth();
  // 标题衬线体(Noto Serif SC):原生打包一个字重,web 走 Google Fonts CDN(见 src/useAppFonts*)。
  const fontsLoaded = useAppFonts();
  const ready = authReady && fontsLoaded;
  const segments = useSegments();
  const router = useRouter();

  // 集中式会话门控,覆盖所有路由(深链 / 刷新直接打开 /chat、/history、/works 也会被拦):
  // 无会话 → 除登录页外都跳登录页;有会话却停在登录页 → 进创作页。
  // DEV_NO_AUTH(本地只做 UI/agent、完全不碰 Supabase)下不拦截。
  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login';
    const needsAuth = !session && !DEV_NO_AUTH;
    if (needsAuth && !onLogin) {
      router.replace('/login');
    } else if (!needsAuth && onLogin) {
      router.replace('/');
    }
  }, [ready, session, segments, router]);

  if (!ready) {
    return (
      <View style={[styles.loading, { backgroundColor: defaultTheme.palette.pageBg }]}>
        <ActivityIndicator color={defaultTheme.accent} />
        <Text style={[styles.loadingText, { color: defaultTheme.palette.textSecondary }]}>
          正在准备…
        </Text>
      </View>
    );
  }

  // 会话门控集中在上面的 effect;此处只渲染导航栈。
  // 方案 B 不需要 Provider:每个对话屏用 useScreenplayAgent(threadId) 自持一个 HttpAgent,
  // 直接消费共享状态(Screenplay)与文本流。见 src/agui/client.ts。
  return (
    <>
      <StatusBar style="dark" />
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
        {/* 登录页自带品牌区与全屏布局,隐藏原生 Stack 顶栏。 */}
        <Stack.Screen name="login" options={{ headerShown: false }} />
        {/* 对话屏自带定制顶栏(返回 + 标题/阶段 + 文档),隐藏原生 Stack 顶栏。 */}
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        <Stack.Screen name="history" options={{ title: '历史会话' }} />
        <Stack.Screen name="works" options={{ title: '作品' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
});
