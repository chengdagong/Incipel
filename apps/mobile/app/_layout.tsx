// 根布局。
// 顶部必须先装 polyfill:Hermes 缺一批 Web API,supabase-js 与 @ag-ui/client(SSE 流式)都依赖它们
// (见 system-design §13「RN 包较新,有坑(Hermes polyfill…)」)。务必排在所有业务 import 之前。
// 平台差异封装在 ../src/polyfills 里(原生装 polyfill;web 走 polyfills.web.ts 空实现)。
import '../src/polyfills';

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ensureSession } from '../src/supabase';
import { useAppFonts } from '../src/useAppFonts';
import { defaultTheme, fonts } from '../src/theme';
import { DrawerProvider } from '../src/drawer/DrawerProvider';
import { I18nProvider } from '../src/i18n';

export default function RootLayout() {
  const [sessionReady, setSessionReady] = useState(false);
  // 标题衬线体(Noto Serif SC):原生打包一个字重,web 走 Google Fonts CDN(见 src/useAppFonts*)。
  const fontsLoaded = useAppFonts();
  const ready = sessionReady && fontsLoaded;

  // 初始化 Supabase 匿名登录(system-design §2/§16)。
  useEffect(() => {
    let mounted = true;
    ensureSession()
      .catch(() => {
        // Supabase 未配置/不可达时,匿名登录失败不应阻塞 app
        //(本地试用走 agent 的 DEV_NO_AUTH,不依赖 Supabase)。
      })
      .finally(() => {
        if (mounted) setSessionReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // I18nProvider 包住一切(含抽屉),任意屏用 useT() 取界面文案(见 issue #13);
  // 它只切界面文案,不影响 AI 回复语言(见 ADR-0004 / i18n.tsx 的 langDesc)。
  return <I18nProvider>{ready ? <AppShell /> : <Preparing />}</I18nProvider>;
}

function Preparing() {
  return (
    <View style={[styles.loading, { backgroundColor: defaultTheme.palette.pageBg }]}>
      <ActivityIndicator color={defaultTheme.accent} />
      <Text style={[styles.loadingText, { color: defaultTheme.palette.textSecondary }]}>正在准备…</Text>
    </View>
  );
}

function AppShell() {
  // DrawerProvider 把侧边抽屉浮层挂在整个 Stack 之上,任意屏可 useDrawer().open()(system-design §2.1)。
  // history / works 的标题由各屏自设(用 t(),随语言切换),settings 自带顶栏。
  return (
    <DrawerProvider>
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
        {/* 欢迎屏自带页内顶栏(左上汉堡唤抽屉),隐藏原生 Stack 顶栏。 */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* 对话屏自带定制顶栏(返回 + 标题/阶段 + 文档),隐藏原生 Stack 顶栏。 */}
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        {/* 设置屏自带顶栏(返回 + 标题)。 */}
        <Stack.Screen name="settings" options={{ headerShown: false }} />
      </Stack>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
});
