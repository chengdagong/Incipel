// 设置页(issue #13):账号区(匿名/已登录两态)+ 通用 → 界面语言下拉 + 登出。
// 视觉按原型 SETTINGS SCREEN 还原。多语言只切界面文案,不影响 AI 回复语言(见 i18n.tsx)。
//
// 账号/登录本身在另一 worktree(issue #8/#9/#10)做:本页只实现「框架 + 语言切换 + 两态展示」,
// 「登录 ›」「登出」先留占位。v1 只有匿名会话,故默认匿名态。

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGS, useI18n } from '../../src/i18n';
import { defaultTheme } from '../../src/theme';

// 原型 SETTINGS 专用配色(literal,逐项对原型取色)。
const S = {
  divider: '#F0EDE7',
  back: '#9A958C',
  title: '#2A2825',
  avatarAnonBg: '#EDE8E0',
  avatarAnonText: '#A39E94',
  primary: '#2A2825',
  sub: '#A39E94',
  sectionLabel: '#A39E94',
  cardBorder: '#E8E3D9',
  rowText: '#2A2825',
  rowValue: '#9A958C',
  caret: '#C2BDB3',
  dropDivider: '#F2EFE9',
  langText: '#3A352F',
  globe: '#7C776E',
  signOutBorder: '#ECDAD2',
  signOutText: '#C0654A',
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang, setLang } = useI18n();
  const { accent } = defaultTheme;

  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // v1 只有匿名会话(登录在另一 worktree)。账号绑定后这里改为读真实身份。
  const isSignedIn = false;
  const accountInitial = (t('guestName').charAt(0) || '你').toUpperCase();
  const currentLangName = LANGS.find((l) => l.code === lang)?.name ?? '';

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={[styles.screen, { backgroundColor: defaultTheme.palette.pageBg, paddingTop: insets.top }]}>
      {/* 顶栏 */}
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('settingsTitle')}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* 账号区:匿名态(整行可点 → 登录入口,占位)。已登录态见下方注释。 */}
        {isSignedIn ? null : (
          <Pressable
            style={styles.accountRow}
            onPress={() => {
              // 登录入口属另一 worktree(#8/#9/#10),此处先占位。
            }}
            accessibilityRole="button"
          >
            <View style={[styles.avatar, { backgroundColor: S.avatarAnonBg }]}>
              <Text style={[styles.avatarText, { color: S.avatarAnonText }]}>{accountInitial}</Text>
            </View>
            <View style={styles.accountMain}>
              <Text style={styles.accountName}>{t('notSignedIn')}</Text>
              <Text style={styles.accountSub}>{t('anonSub')}</Text>
            </View>
            <Text style={[styles.signIn, { color: accent }]}>{t('signIn')} ›</Text>
          </Pressable>
        )}

        {/* 通用 */}
        <Text style={styles.sectionLabel}>{t('generalSection')}</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.langRow}
            onPress={() => setLangMenuOpen((v) => !v)}
            accessibilityRole="button"
          >
            <View style={styles.langLeft}>
              <Globe />
              <Text style={styles.langLabel}>{t('langLabel')}</Text>
            </View>
            <View style={styles.langRight}>
              <Text style={styles.langValue}>{currentLangName}</Text>
              <Text style={styles.caret}>▾</Text>
            </View>
          </Pressable>

          {langMenuOpen && (
            <View style={styles.dropdown}>
              {LANGS.map((l) => (
                <Pressable
                  key={l.code}
                  style={styles.langItem}
                  onPress={() => {
                    setLang(l.code);
                    setLangMenuOpen(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.langItemText}>{l.name}</Text>
                  {l.code === lang && <Text style={[styles.check, { color: accent }]}>✓</Text>}
                </Pressable>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.langDesc}>{t('langDesc')}</Text>

        {/* 登出(仅已登录态;v1 匿名态不显示。登出动作复用 #8/#9/#10)。 */}
        {isSignedIn && (
          <Pressable style={styles.signOut} accessibilityRole="button">
            <Text style={styles.signOutText}>{t('signOut')}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// 简化地球图标(无 react-native-svg):圆环 + 一条水平线。
function Globe() {
  return (
    <View style={styles.globe}>
      <View style={styles.globeBar} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: S.divider,
  },
  back: { fontSize: 22, lineHeight: 22, color: S.back, paddingVertical: 4, paddingHorizontal: 6 },
  title: { fontSize: 15, color: S.title, fontWeight: '600' },

  content: { paddingTop: 20, paddingHorizontal: 18 },

  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    marginBottom: 8,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '600' },
  accountMain: { flex: 1, flexShrink: 1 },
  accountName: { fontSize: 16, color: S.primary, fontWeight: '600' },
  accountSub: { fontSize: 12.5, color: S.sub, marginTop: 2, lineHeight: 18.75 },
  signIn: { fontSize: 13, fontWeight: '600' },

  sectionLabel: {
    fontSize: 12,
    color: S.sectionLabel,
    letterSpacing: 0.5,
    paddingTop: 4,
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  card: { borderWidth: 1, borderColor: S.cardBorder, borderRadius: 16, backgroundColor: '#fff', overflow: 'hidden' },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  langLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  langLabel: { fontSize: 15, color: S.rowText },
  langRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  langValue: { fontSize: 14, color: S.rowValue },
  caret: { fontSize: 13, color: S.caret },

  dropdown: { borderTopWidth: 1, borderTopColor: S.dropDivider },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingRight: 16,
    paddingLeft: 48,
  },
  langItemText: { fontSize: 14.5, color: S.langText },
  check: { fontSize: 14, fontWeight: '700' },

  langDesc: { fontSize: 12.5, color: S.sub, lineHeight: 20, paddingTop: 11, paddingHorizontal: 8 },

  signOut: {
    marginTop: 24,
    padding: 15,
    borderWidth: 1,
    borderColor: S.signOutBorder,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  signOutText: { color: S.signOutText, fontSize: 15, fontWeight: '600' },

  globe: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: S.globe,
    alignItems: 'center',
    justifyContent: 'center',
  },
  globeBar: { width: 16, height: 1.6, backgroundColor: S.globe },
});
