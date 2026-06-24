// 登录页(ADR-0005:v1 入口)。设计图还原。
// - 真接:Apple(仅 iOS)、Google(iOS / Android)、先随便逛逛(匿名)。
// - 暂不接:用邮箱继续 —— 灰显,点了提示「即将开放」,不放点了报错的死按钮。
// - Apple 仅在 iOS 渲染;Google 与匿名是 Android 真入口。

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEV_NO_AUTH, useAuth } from '../src/auth';
import { googleAuthLogDetailsForDebug, googleAuthMessageKey, signInWithGoogle } from '../src/google-auth';
import { useI18n } from '../src/i18n';
import { signInAnonymously, signInWithApple } from '../src/supabase';
import { defaultTheme } from '../src/theme';

// 法务地址:由 website/ 下的静态页面经 GitHub Pages 发布(见 .github/workflows/deploy-legal-pages.yml)。
// 正文按当前实现撰写;联系邮箱 / 生效日期 / 适用法律等可变信息见 website/README.md,数据做法变化时同步更新。
// 日后绑定自有域名 incipel.app 后,把下面两个常量改成自有域名地址即可。
const TERMS_URL = 'https://chengdagong.github.io/Incipel/legal/terms/';
const PRIVACY_URL = 'https://chengdagong.github.io/Incipel/legal/privacy/';

export default function LoginScreen() {
  const { session } = useAuth();
  const { t } = useI18n();
  const { palette, accent } = defaultTheme;
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 暂不接的入口点击后的瞬时提示;几秒后自动消失。
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  // 已有会话(含匿名登录成功后由 onAuthStateChange 推来的)→ 进创作页。
  // DEV_NO_AUTH 下也直接放行:此模式不碰 Supabase,登录页不应拦人(与 (app) 组的门控一致,Codex P2)。
  if (session || DEV_NO_AUTH) {
    return <Redirect href="/" />;
  }

  const showApple = Platform.OS === 'ios';

  function comingSoon(label: string) {
    setError(null);
    setNotice(`${label}即将开放`);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }

  // Apple 登录。成功不手动跳转:session 经 onAuthStateChange 更新,上面的 Redirect 接手。
  async function loginWithApple() {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    setError(null);
    try {
      await signInWithApple();
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      // 用户取消:静默留页,不报错(system-design §11)。
      if (code === 'ERR_REQUEST_CANCELED') {
        setBusy(false);
        return;
      }
      console.warn('[login] Apple 登录失败:', e);
      setError('登录失败,请重试。');
      setBusy(false);
    }
  }

  function googleMessage(e: unknown): string | null {
    const key = googleAuthMessageKey(e, 'login');
    return key ? t(key) : null;
  }

  // Google 登录。代码路径与 Apple 分开:Google native SDK → Supabase signInWithIdToken。
  async function loginWithGoogle() {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const message = googleMessage(e);
      if (message) {
        console.warn('[login] Google 登录失败:', googleAuthLogDetailsForDebug(e));
        setError(message);
      }
      setBusy(false);
    }
  }

  // 「先随便逛逛」= 匿名登录。成功不手动跳转:session 经 onAuthStateChange 更新,上面的 Redirect 接手。
  async function browseAnonymously() {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    setError(null);
    try {
      await signInAnonymously();
    } catch (e) {
      console.warn('[login] 匿名登录失败:', e);
      // 明确反馈、可重试,不静默、不编造(system-design §11)。
      setError('没能进入,请稍后重试。');
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: palette.pageBg, paddingTop: insets.top, paddingBottom: insets.bottom + 12 },
      ]}
    >
      {/* 品牌区:占据上半部、垂直居中。 */}
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: palette.avatarBg }]}>
          <Text style={styles.logoText}>织幕</Text>
        </View>
        <Text style={[styles.title, { color: palette.textPrimary }]}>从灵感到剧本</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          一个 AI 原生的编剧助手,陪你一步步把故事做出来。
        </Text>
      </View>

      {/* 入口区:贴近底部。 */}
      <View style={styles.actions}>
        {showApple && (
          // App Store 合规要求用原生 Sign in with Apple 按钮发起登录(它自带 Apple 标志、
          // 系统本地化文案、设备不可用处理);自绘按钮可能被审核拒(Codex P1)。
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={16}
            style={styles.appleBtn}
            onPress={loginWithApple}
          />
        )}

        <Pressable
          style={[
            styles.btn,
            styles.outlineBtn,
            { borderColor: palette.border, backgroundColor: palette.cardBg },
          ]}
          onPress={loginWithGoogle}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="通过 Google 登录"
          testID="login-google"
        >
          <Text style={[styles.btnIcon, styles.googleG]}>G</Text>
          <Text style={[styles.btnLabel, { color: palette.textPrimary }]}>通过 Google 登录</Text>
        </Pressable>

        <Pressable
          style={[
            styles.btn,
            styles.outlineBtn,
            styles.deferred,
            { borderColor: palette.border, backgroundColor: palette.cardBg },
          ]}
          onPress={() => comingSoon('邮箱登录')}
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel="用邮箱继续,即将开放"
        >
          <Text style={[styles.btnIcon, { color: palette.textPrimary }]}>{'✉'}</Text>
          <Text style={[styles.btnLabel, { color: palette.textPrimary }]}>用邮箱继续</Text>
        </Pressable>

        {/* 瞬时提示 / 错误:互斥地占一行,避免布局跳动。 */}
        <Text style={[styles.hint, { color: error ? palette.danger : palette.textSecondary }]}>
          {error ?? notice ?? ' '}
        </Text>

        <Pressable
          style={styles.browse}
          onPress={browseAnonymously}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="先随便逛逛"
          testID="login-anon"
        >
          {busy ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Text style={[styles.browseLabel, { color: accent }]}>先随便逛逛</Text>
          )}
        </Pressable>

        <Text style={[styles.terms, { color: palette.textSecondary }]}>
          继续即表示同意
          <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>
            服务条款
          </Text>
          与
          <Text style={styles.termsLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            隐私政策
          </Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 28 },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    // 柔和投影,贴合设计稿。
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  logoText: { color: '#FBFAF7', fontSize: 30, fontWeight: '600', fontFamily: defaultTheme.fonts.serifTitle },
  title: {
    marginTop: 28,
    fontSize: 30,
    fontWeight: '700',
    fontFamily: defaultTheme.fonts.serifTitle,
    textAlign: 'center',
  },
  subtitle: { marginTop: 14, fontSize: 15, lineHeight: 23, textAlign: 'center', maxWidth: 300 },

  actions: { gap: 12 },
  // 原生 Apple 按钮按 style 定尺寸(颜色由 buttonStyle=BLACK 决定,圆角由 cornerRadius 属性给)。
  appleBtn: { height: 56, width: '100%' },
  btn: {
    minHeight: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  outlineBtn: { borderWidth: 1 },
  // 暂不接的入口灰显(ADR-0005):呈现但点了提示「即将开放」。
  deferred: { opacity: 0.5 },
  btnIcon: { fontSize: 18, fontWeight: '600' },
  btnLabel: { fontSize: 16, fontWeight: '600' },
  googleG: { color: '#4285F4', fontSize: 18, fontWeight: '800' },

  hint: { textAlign: 'center', fontSize: 13, minHeight: 18 },
  browse: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  browseLabel: { fontSize: 16, fontWeight: '600' },
  terms: { textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 4 },
  termsLink: { textDecorationLine: 'underline' },
});
