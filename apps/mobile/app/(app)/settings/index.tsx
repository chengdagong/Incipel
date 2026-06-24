// 设置索引页(类别菜单):顶部账号横幅 + 分组类别列表。点类别 push 进对应详情页。
// 重排前设置是单页平铺(账号 / 通用 / 开发 / 阅读 / 登出 堆在一起);现按类别拆分,索引页只做导航,
// 不在此就地改设置(绑定 Google / 登出等移入「账号」详情页)。
//
// 账号横幅两态:已登录(有会话且非匿名)显示头像 + 邮箱 / provider;匿名仍视为「未登录」,
// 引导进账号页绑定 Google(见 settings/account.tsx)。

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LANGS, READING_I18N, useI18n } from '../../../src/i18n';
import { palette } from '../../../src/theme';
import { useAgentEndpointSettings } from '../../../src/agentEndpoint';
import { useAccountIdentity } from '../../../src/accountIdentity';
import { SettingsGroup, SettingsRow, SettingsScreen } from '../../../src/components/SettingsScaffold';

export default function SettingsIndexScreen() {
  const router = useRouter();
  const { t, lang } = useI18n();
  // 横幅身份与「账号」详情页共用同一派生(含 provider 解析),不在索引页另写一份。
  const { isSignedIn, name: accountName, sub: accountSub, initial: accountInitial } = useAccountIdentity();
  const agentEndpoint = useAgentEndpointSettings();
  const currentLangName = LANGS.find((l) => l.code === lang)?.name ?? '';

  // 索引页是设置区入口:正常经抽屉 push 进来(可 back);冷启动 / 深链直达 /settings 时没有上一屏,
  // 回欢迎页而非用 /settings 自我替换(后者会让返回钮失效、把人困在本页)。
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <SettingsScreen title={t('settingsTitle')} onBack={back} testID="settings-index">
      {/* 账号横幅:整块可点,进账号详情页 */}
      <Pressable
        onPress={() => router.push('/settings/account')}
        accessibilityRole="button"
        style={({ pressed }) => [styles.banner, pressed ? styles.bannerPressed : null]}
        testID="settings-account-banner"
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
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {/* 偏好类:通用(界面语言)、阅读(剧本字号 / 行距) */}
      <SettingsGroup>
        <SettingsRow
          label={t('generalSection')}
          value={currentLangName}
          onPress={() => router.push('/settings/general')}
          testID="settings-cat-general"
        />
        <SettingsRow
          label={READING_I18N[lang].section}
          onPress={() => router.push('/settings/reading')}
          testID="settings-cat-reading"
        />
      </SettingsGroup>

      {/* 开发类:仅 Expo Go / development build 显示(release 不可见) */}
      {agentEndpoint.visible ? (
        <SettingsGroup>
          <SettingsRow
            label={t('agentEndpointSection')}
            onPress={() => router.push('/settings/developer')}
            testID="settings-cat-developer"
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
  chevron: { fontSize: 18, lineHeight: 18, color: palette.placeholder },
});
