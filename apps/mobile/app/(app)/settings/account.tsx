// 设置 ›账号:账号态展示 + 匿名绑定 Google + 登出。
// 已登录(有会话且非匿名)= 显示头像 + 邮箱 / provider,底部「登出」(二次确认后清会话,(app) 门控回登录页)。
// 匿名(先随便逛逛)仍视为「未登录」,横幅可点以绑定 Google,保留当前匿名用户的作品。
// 逻辑由旧单页设置迁出,行为不变。

import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  googleAuthLogDetailsForDebug,
  googleAuthMessageKey,
  linkGoogleIdentity,
} from '../../../src/google-auth';
import { SETTINGS_I18N, useI18n } from '../../../src/i18n';
import { signOut } from '../../../src/supabase';
import { defaultTheme, palette } from '../../../src/theme';
import { useAccountIdentity } from '../../../src/accountIdentity';
import { SettingsGroup, SettingsRow, SettingsScreen } from '../../../src/components/SettingsScaffold';

export default function AccountSettingsScreen() {
  const { t, lang } = useI18n();
  const { accent } = defaultTheme;
  // 身份派生(登录态 / 显示名 / 副标题 / 头像首字 / provider)与索引页横幅共用一处;
  // setProviderLabel 用于绑定 Google 成功后乐观更新副标题。
  const { isSignedIn, name: accountName, sub: accountSub, initial: accountInitial, setProviderLabel } =
    useAccountIdentity();

  const [signingOut, setSigningOut] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  function confirmSignOut() {
    Alert.alert(t('signOutConfirm'), t('signOutConfirmSub'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('signOut'), style: 'destructive', onPress: doSignOut },
    ]);
  }

  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // 成功后 session→null,(app) 门控把人送回登录页;此处不手动导航(与登录一致)。
    } catch (e) {
      // 不静默、不编造:失败留页、复位按钮,可重试。
      console.warn('[settings/account] 登出失败:', e);
      setSigningOut(false);
    }
  }

  async function bindGoogle() {
    if (linkingGoogle) return;
    setAccountError(null);
    setLinkingGoogle(true);
    try {
      await linkGoogleIdentity();
      setProviderLabel('google');
    } catch (e) {
      const key = googleAuthMessageKey(e, 'link');
      if (key) {
        console.warn('[settings/account] Google 绑定失败:', googleAuthLogDetailsForDebug(e));
        setAccountError(t(key));
      }
    } finally {
      setLinkingGoogle(false);
    }
  }

  return (
    <SettingsScreen title={SETTINGS_I18N[lang].account} testID="settings-account">
      {/* 账号横幅:已登录静态展示;匿名可点以绑定 Google */}
      <Pressable
        style={({ pressed }) => [styles.banner, !isSignedIn && pressed ? styles.bannerPressed : null]}
        onPress={isSignedIn ? undefined : bindGoogle}
        disabled={isSignedIn || linkingGoogle}
        accessibilityRole={isSignedIn ? undefined : 'button'}
      >
        <View style={[styles.avatar, { backgroundColor: isSignedIn ? palette.avatarBg : palette.mutedBg }]}>
          <Text style={[styles.avatarText, { color: isSignedIn ? '#fff' : palette.textSecondary }]}>{accountInitial}</Text>
        </View>
        <View style={styles.bannerMain}>
          <Text style={styles.bannerName} numberOfLines={1}>
            {accountName}
          </Text>
          {accountSub ? (
            <Text style={styles.bannerSub} numberOfLines={2}>
              {accountSub}
            </Text>
          ) : null}
        </View>
        {!isSignedIn ? (
          linkingGoogle ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Text style={[styles.linkAction, { color: accent }]}>{t('linkGoogle')} ›</Text>
          )
        ) : null}
      </Pressable>
      {accountError ? <Text style={styles.accountError}>{accountError}</Text> : null}

      {/* 登出:仅已登录态 */}
      {isSignedIn ? (
        <SettingsGroup>
          <SettingsRow
            label={t('signOut')}
            danger
            onPress={confirmSignOut}
            disabled={signingOut}
            right={signingOut ? <ActivityIndicator color={palette.danger} /> : null}
            testID="settings-sign-out"
          />
        </SettingsGroup>
      ) : null}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.borderAlt,
    borderRadius: 16,
    backgroundColor: palette.cardBg,
  },
  bannerPressed: { backgroundColor: palette.pressedBg },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '600' },
  bannerMain: { flex: 1, flexShrink: 1 },
  bannerName: { fontSize: 16, color: palette.textPrimary, fontWeight: '600' },
  bannerSub: { fontSize: 12.5, color: palette.textSecondary, marginTop: 2, lineHeight: 18.75 },
  linkAction: { fontSize: 13, fontWeight: '600' },
  accountError: { color: palette.danger, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 8, marginTop: 8 },
});
