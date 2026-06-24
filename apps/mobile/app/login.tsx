// 登录页(ADR-0005:v1 入口)。视觉严格对齐最新 handoff 原型「SPLASH / AUTH」屏。
// - 真接:Apple(仅 iOS)、Google(iOS / Android)、先随便逛逛(匿名)。
// - 暂不接:用邮箱继续 —— 点了提示「即将开放」,不放点了报错的死按钮(ADR-0005)。
// - 文案走 i18n(splashTitle / appleBtn / … ),与原型一致。

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
import { TERMS_I18N, useI18n } from '../src/i18n';
import { signInAnonymously, signInWithApple } from '../src/supabase';
import { defaultTheme } from '../src/theme';

const { palette, accent, fonts, shadows } = defaultTheme;

// 法务地址:由 website/ 下的静态页面经 GitHub Pages 发布(见 .github/workflows/deploy-legal-pages.yml)。
// 正文按当前实现撰写;联系邮箱 / 生效日期 / 适用法律等可变信息见 website/README.md,数据做法变化时同步更新。
// 日后绑定自有域名 incipel.app 后,把下面两个常量改成自有域名地址即可。
const TERMS_URL = 'https://chengdagong.github.io/Incipel/legal/terms/';
const PRIVACY_URL = 'https://chengdagong.github.io/Incipel/legal/privacy/';

export default function LoginScreen() {
  const { session } = useAuth();
  const { t, lang } = useI18n();
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
  if (session || DEV_NO_AUTH) {
    return <Redirect href="/" />;
  }

  const showApple = Platform.OS === 'ios';

  function comingSoon(feature: string) {
    setError(null);
    setNotice(t('comingSoon', { feature }));
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
      if (code === 'ERR_REQUEST_CANCELED') {
        setBusy(false);
        return;
      }
      console.warn('[login] Apple 登录失败:', e);
      setError(t('loginFailed'));
      setBusy(false);
    }
  }

  function googleMessage(e: unknown): string | null {
    const key = googleAuthMessageKey(e, 'login');
    return key ? t(key) : null;
  }

  // Google 登录。Google native SDK → Supabase signInWithIdToken。
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

  // 「先随便逛逛」= 匿名登录。
  async function browseAnonymously() {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    setError(null);
    try {
      await signInAnonymously();
    } catch (e) {
      console.warn('[login] 匿名登录失败:', e);
      setError(t('enterFailed'));
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: palette.pageBg, paddingTop: insets.top, paddingBottom: insets.bottom + 30 },
      ]}
    >
      {/* 品牌区:占据上半部、垂直居中(原型 flex:1 居中)。 */}
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: palette.avatarBg }, shadows.logo]}>
          <Text style={styles.logoText}>织幕</Text>
        </View>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{t('splashTitle')}</Text>
        <Text style={[styles.tagline, { color: palette.textSecondary }]}>{t('splashTagline')}</Text>
      </View>

      {/* 入口区:贴近底部,纵向 gap 11。 */}
      <View style={styles.actions}>
        {showApple && (
          // App Store 合规要求用原生 Sign in with Apple 按钮发起登录。
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={14}
            style={styles.appleBtn}
            onPress={loginWithApple}
          />
        )}

        <Pressable
          style={[styles.btn, { borderColor: palette.border, backgroundColor: palette.cardBg }]}
          onPress={loginWithGoogle}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('googleBtn')}
          testID="login-google"
        >
          <Text style={[styles.btnIcon, styles.googleG]}>G</Text>
          <Text style={[styles.btnLabel, { color: palette.textPrimary }]}>{t('googleBtn')}</Text>
        </Pressable>

        <Pressable
          style={[styles.btn, { borderColor: palette.border, backgroundColor: palette.cardBg }]}
          onPress={() => comingSoon(t('emailBtn'))}
          accessibilityRole="button"
          accessibilityLabel={t('emailBtn')}
        >
          <Text style={[styles.btnIcon, { color: palette.placeholder }]}>{'✉'}</Text>
          <Text style={[styles.btnLabel, { color: palette.textPrimary }]}>{t('emailBtn')}</Text>
        </Pressable>

        <Pressable
          style={styles.browse}
          onPress={browseAnonymously}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('continueAnon')}
          testID="login-anon"
        >
          {busy ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Text style={[styles.browseLabel, { color: accent }]}>{t('continueAnon')}</Text>
          )}
        </Pressable>

        {/* 瞬时提示 / 错误:仅在有内容时占位,贴合原型干净的底部。 */}
        {(error || notice) && (
          <Text style={[styles.hint, { color: error ? palette.danger : palette.textSecondary }]}>
            {error ?? notice}
          </Text>
        )}

        {/* 法务行:服务条款 / 隐私政策可点开(App Store 要求隐私政策 URL 可达,ADR-0005)。 */}
        <Text style={[styles.terms, { color: palette.placeholder }]}>
          {TERMS_I18N[lang].pre}
          <Text
            style={[styles.termsLink, { color: palette.textSecondary }]}
            onPress={() => Linking.openURL(TERMS_URL)}
          >
            {TERMS_I18N[lang].terms}
          </Text>
          {TERMS_I18N[lang].mid}
          <Text
            style={[styles.termsLink, { color: palette.textSecondary }]}
            onPress={() => Linking.openURL(PRIVACY_URL)}
          >
            {TERMS_I18N[lang].privacy}
          </Text>
          {TERMS_I18N[lang].post}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 30 },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 74,
    height: 74,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  logoText: { color: '#fff', fontSize: 27, fontWeight: '600', letterSpacing: 1, fontFamily: fonts.serifTitle },
  title: {
    fontSize: 29,
    fontWeight: '600',
    lineHeight: 38,
    letterSpacing: -0.3,
    fontFamily: fonts.serifTitle,
    textAlign: 'center',
    marginBottom: 14,
  },
  tagline: { fontSize: 14.5, lineHeight: 24.5, textAlign: 'center', maxWidth: 268 },

  actions: { gap: 11 },
  // 原生 Apple 按钮按 style 定尺寸(颜色 BLACK,圆角由 cornerRadius 给)。原型 padding:15 ≈ 高 50。
  appleBtn: { height: 50, width: '100%' },
  btn: {
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    paddingHorizontal: 15,
  },
  btnIcon: { fontSize: 17, fontWeight: '600' },
  btnLabel: { fontSize: 15, fontWeight: '600' },
  googleG: { color: '#4285F4', fontSize: 18, fontWeight: '800' },

  hint: { textAlign: 'center', fontSize: 13, paddingTop: 2 },
  browse: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  browseLabel: { fontSize: 14, fontWeight: '600' },
  terms: { textAlign: 'center', fontSize: 11, lineHeight: 17.6, paddingHorizontal: 16, paddingTop: 2 },
  termsLink: { textDecorationLine: 'underline' },
});
