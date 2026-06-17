// 根布局。
// 顶部必须先装 polyfill:Hermes 缺一批 Web API,supabase-js 与 @ag-ui/client(SSE 流式)都依赖它们
// (见 system-design §13「RN 包较新,有坑(Hermes polyfill…)」)。务必排在所有业务 import 之前。
//
// 直连 AG-UI(方案 B)后,这些 polyfill 原先由 @copilotkit/react-native 内置代装,现在自带:
//   1) URL —— supabase-js 用。
//   2) ReadableStream / WritableStream / TransformStream —— SSE fetch streaming 用。
//      web-streams-polyfill 的 `/polyfill` 子路径是自安装包(直接挂到 globalThis)。
//   3) TextEncoder / TextDecoder —— 解析 SSE 字节流用;text-encoding 无自安装入口,手动挂全局。
import 'react-native-get-random-values'; // crypto.getRandomValues polyfill — 必须最先(uuid/randomUUID 依赖)
import 'react-native-url-polyfill/auto';
// 自安装、自包含的 ES5 构建:把 ReadableStream/WritableStream/TransformStream 挂到 globalThis。
// (v4 的 `/polyfill` 子路径与 main 入口在 Metro 下都解析不稳,直接指向 dist 文件最稳。)
import 'web-streams-polyfill/dist/polyfill.es5.js';
import { TextEncoder, TextDecoder } from 'text-encoding';

{
  // text-encoding 无自安装入口,手动挂全局。
  const g = globalThis as Record<string, unknown>;
  if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoder;
  if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder;
}

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ensureSession } from '../src/supabase';
import { defaultTheme } from '../src/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // 初始化 Supabase 匿名登录(system-design §2/§16)。
  useEffect(() => {
    let mounted = true;
    ensureSession()
      .catch(() => {
        // Supabase 未配置/不可达时,匿名登录失败不应阻塞 app
        //(本地试用走 agent 的 DEV_NO_AUTH,不依赖 Supabase)。
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  // 方案 B 不需要 Provider:每个对话屏用 useScreenplayAgent(threadId) 自持一个 HttpAgent,
  // 直接消费共享状态(Screenplay)与文本流。见 src/agui/client.ts。
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: defaultTheme.palette.pageBg },
          headerTintColor: defaultTheme.palette.textPrimary,
          contentStyle: { backgroundColor: defaultTheme.palette.pageBg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '芯' }} />
        <Stack.Screen name="chat" options={{ title: '创作' }} />
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
