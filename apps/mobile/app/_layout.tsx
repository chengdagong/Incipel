// 根布局。
// 顶部必须先装 polyfill:Hermes 缺一批 Web API,supabase-js 与 @ag-ui/client(SSE 流式)都依赖它们
// (见 system-design §13「RN 包较新,有坑(Hermes polyfill…)」)。务必排在所有业务 import 之前。
// 平台差异封装在 ../src/polyfills 里(原生装 polyfill;web 走 polyfills.web.ts 空实现)。
import '../src/polyfills';
import '../src/rn-compat';

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/auth';
import { useAppFonts } from '../src/useAppFonts';
import { defaultTheme } from '../src/theme';
import { I18nProvider } from '../src/i18n';

export default function RootLayout() {
  // 会话状态在 AuthProvider 内维护;启动只读、不自动建会话(ADR-0005)。
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { ready: authReady } = useAuth();
  // 标题衬线体(Noto Serif SC):原生打包一个字重,web 走 Google Fonts CDN(见 src/useAppFonts*)。
  const fontsLoaded = useAppFonts();
  const ready = authReady && fontsLoaded;

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
  // 根 Stack 只挂登录页与受保护路由组 (app);会话门控与侧边抽屉(DrawerProvider)都在 (app)/_layout 里。
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: defaultTheme.palette.pageBg },
        }}
      >
        {/* 登录页(组外,无会话可达);自带品牌区与全屏布局。 */}
        <Stack.Screen name="login" />
        {/* 受保护路由组:其 layout 做会话门控 + 挂侧边抽屉,内部各屏自带顶栏。 */}
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
});
