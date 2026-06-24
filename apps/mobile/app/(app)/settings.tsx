// 设置页(issue #13):账号区(匿名/已登录两态)+ 通用 → 界面语言下拉 + 登出。
// 视觉按原型 SETTINGS SCREEN 还原。多语言只切界面文案,不影响 AI 回复语言(见 i18n.tsx)。
//
// 账号态读自 useAuth():有会话且非匿名 = 已登录,按 provider 显示 Google / Apple;
// 匿名会话(先随便逛逛)仍视为「未登录」,可在此绑定 Google 并保留当前用户的作品。

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth';
import {
  getGoogleProviderLabel,
  googleAuthLogDetailsForDebug,
  googleAuthMessageKey,
  linkGoogleIdentity,
} from '../../src/google-auth';
import { LANGS, READING_I18N, useI18n } from '../../src/i18n';
import { signOut } from '../../src/supabase';
import { defaultTheme, palette } from '../../src/theme';
import { useReadingPrefs } from '../../src/readingPrefs';
import { ReaderText } from '../../src/components/ReaderText';
import type { FontLevel, LineLevel } from '../../src/readingScale';

// 设置页各处用色统一引自通用 palette(过去这里是逐项对原型取色的字面色表,已归并)。
// back / 副标题 / 标签 / 行值原先是 #9A958C / #A39E94 等浅灰(对比 ~2.x:1),现走 palette.textSecondary;
// 登出按钮的文字与描边走语义色 palette.danger / dangerBorder。
const S = {
  divider: palette.divider,
  back: palette.textSecondary,
  title: palette.textPrimary,
  avatarAnonBg: palette.mutedBg,
  avatarAnonText: palette.textSecondary,
  primary: palette.textPrimary,
  sub: palette.textSecondary,
  sectionLabel: palette.textSecondary,
  cardBorder: palette.borderAlt,
  rowText: palette.textPrimary,
  rowValue: palette.textSecondary,
  caret: palette.textSecondary,
  dropDivider: palette.divider,
  langText: palette.textPrimaryAlt,
  globe: palette.textSecondary,
  signOutBorder: palette.dangerBorder,
  signOutText: palette.danger,
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang, setLang } = useI18n();
  const { accent, accentSoft, accentSoftBorder } = defaultTheme;
  const reading = READING_I18N[lang];
  const { fontLevel, lineLevel, setFontLevel, setLineLevel } = useReadingPrefs();
  const fontOptions: { value: FontLevel; label: string }[] = [
    { value: 'small', label: reading.fontSmall },
    { value: 'standard', label: reading.fontStandard },
    { value: 'large', label: reading.fontLarge },
    { value: 'xlarge', label: reading.fontXLarge },
  ];
  const lineOptions: { value: LineLevel; label: string }[] = [
    { value: 'compact', label: reading.lineCompact },
    { value: 'standard', label: reading.lineStandard },
    { value: 'loose', label: reading.lineLoose },
  ];
  const { session } = useAuth();

  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [providerLabel, setProviderLabel] = useState<'google' | 'apple' | 'signed-in'>('signed-in');
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const user = session?.user ?? null;
  // 已登录 = 有会话且非匿名;匿名会话仍视为「未登录」,提示绑定 Google。
  const isSignedIn = !!user && !user.is_anonymous;
  const providerName =
    providerLabel === 'google' ? t('googleUser') : providerLabel === 'apple' ? t('appleUser') : t('signedInUser');
  // 已登录优先显示邮箱;没有邮箱时显示 provider。
  const accountName = isSignedIn ? user?.email || providerName : t('notSignedIn');
  const accountSub = isSignedIn ? (user?.email ? providerName : '') : t('anonSub');
  const accountInitial = (
    isSignedIn ? accountName.charAt(0) : t('guestName').charAt(0) || '你'
  ).toUpperCase();
  const currentLangName = LANGS.find((l) => l.code === lang)?.name ?? '';

  useEffect(() => {
    let mounted = true;
    if (!user || user.is_anonymous) {
      setProviderLabel('signed-in');
      return () => {
        mounted = false;
      };
    }
    getGoogleProviderLabel({ appMetadataProvider: user.app_metadata?.provider })
      .then((label) => {
        if (mounted) setProviderLabel(label);
      })
      .catch(() => {
        if (mounted) setProviderLabel('signed-in');
      });
    return () => {
      mounted = false;
    };
  }, [user?.id, user?.is_anonymous, user?.app_metadata?.provider]);

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
      // 不静默、不编造(system-design §11):失败留页、复位按钮,可重试。
      console.warn('[settings] 登出失败:', e);
      setSigningOut(false);
    }
  }

  function googleMessage(e: unknown): string | null {
    const key = googleAuthMessageKey(e, 'link');
    return key ? t(key) : null;
  }

  async function bindGoogle() {
    if (linkingGoogle) return;
    setAccountError(null);
    setLinkingGoogle(true);
    try {
      await linkGoogleIdentity();
      setProviderLabel('google');
    } catch (e) {
      const message = googleMessage(e);
      if (message) {
        console.warn('[settings] Google 绑定失败:', googleAuthLogDetailsForDebug(e));
        setAccountError(message);
      }
    } finally {
      setLinkingGoogle(false);
    }
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={[styles.screen, { backgroundColor: defaultTheme.palette.pageBg, paddingTop: insets.top }]}>
      {/* 顶栏 */}
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回" testID="settings-back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('settingsTitle')}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* 账号区:正式账号按 provider 显示;匿名账号可在此绑定 Google。 */}
        {isSignedIn ? (
          <View style={styles.accountRow}>
            {/* 已登录头像用品牌深色(对齐原型 #2A2825),与抽屉 / 对话头像一致;非主色。 */}
            <View style={[styles.avatar, { backgroundColor: palette.avatarBg }]}>
              <Text style={[styles.avatarText, { color: '#fff' }]}>{accountInitial}</Text>
            </View>
            <View style={styles.accountMain}>
              <Text style={styles.accountName} numberOfLines={1}>
                {accountName}
              </Text>
              {accountSub ? <Text style={styles.accountSub}>{accountSub}</Text> : null}
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.accountRow}
            onPress={bindGoogle}
            disabled={linkingGoogle}
            accessibilityRole="button"
          >
            <View style={[styles.avatar, { backgroundColor: S.avatarAnonBg }]}>
              <Text style={[styles.avatarText, { color: S.avatarAnonText }]}>{accountInitial}</Text>
            </View>
            <View style={styles.accountMain}>
              <Text style={styles.accountName}>{t('notSignedIn')}</Text>
              <Text style={styles.accountSub}>{t('anonSub')}</Text>
            </View>
            {linkingGoogle ? (
              <ActivityIndicator color={accent} />
            ) : (
              <Text style={[styles.signIn, { color: accent }]}>{t('linkGoogle')} ›</Text>
            )}
          </Pressable>
        )}
        {accountError ? <Text style={styles.accountError}>{accountError}</Text> : null}

        {/* 通用 */}
        <Text style={styles.sectionLabel}>{t('generalSection')}</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.langRow}
            onPress={() => setLangMenuOpen((v) => !v)}
            accessibilityRole="button"
            testID="settings-lang-row"
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
                  testID={`settings-lang-${l.code}`}
                >
                  <Text style={styles.langItemText}>{l.name}</Text>
                  {l.code === lang && <Text style={[styles.check, { color: accent }]}>✓</Text>}
                </Pressable>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.langDesc}>{t('langDesc')}</Text>

        {/* 阅读:剧本内容字号 / 行距(仅作用于文档与内联卡片) */}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{reading.section}</Text>
        <View style={styles.card}>
          <View style={styles.readingRow}>
            <Text style={styles.readingLabel}>{reading.fontSize}</Text>
            <Segmented
              options={fontOptions}
              value={fontLevel}
              onChange={setFontLevel}
              accent={accent}
              accentSoft={accentSoft}
              accentSoftBorder={accentSoftBorder}
            />
          </View>
          <View style={styles.readingDivider} />
          <View style={styles.readingRow}>
            <Text style={styles.readingLabel}>{reading.lineSpacing}</Text>
            <Segmented
              options={lineOptions}
              value={lineLevel}
              onChange={setLineLevel}
              accent={accent}
              accentSoft={accentSoft}
              accentSoftBorder={accentSoftBorder}
            />
          </View>
        </View>
        <Text style={styles.langDesc}>{reading.desc}</Text>
        <View style={styles.previewCard}>
          <Text style={[styles.previewEyebrow, { color: accent }]}>{reading.previewLabel}</Text>
          <ReaderText style={[styles.previewAct, { color: palette.textPrimary }]}>{reading.sampleAct}</ReaderText>
          <ReaderText style={[styles.previewBeat, { color: palette.textBody }]}>{reading.sampleBeat}</ReaderText>
        </View>

        {/* 登出(仅已登录态)。二次确认后清会话,(app) 门控自动回登录页。 */}
        {isSignedIn && (
          <Pressable
            style={styles.signOut}
            onPress={confirmSignOut}
            disabled={signingOut}
            accessibilityRole="button"
          >
            {signingOut ? (
              <ActivityIndicator color={S.signOutText} />
            ) : (
              <Text style={styles.signOutText}>{t('signOut')}</Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// 分档按钮:一排等宽药丸,选中=暖色浅底 + 主色字(沿用语言项的选中观感)。
function Segmented<T extends string>({
  options,
  value,
  onChange,
  accent,
  accentSoft,
  accentSoftBorder,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent: string;
  accentSoft: string;
  accentSoftBorder: string;
}) {
  return (
    <View style={styles.segRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              styles.segPill,
              on
                ? { backgroundColor: accentSoft, borderColor: accentSoftBorder }
                : { backgroundColor: '#fff', borderColor: palette.borderChip },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`reading-seg-${o.value}`}
          >
            <Text style={[styles.segText, { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
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
  accountError: { color: S.signOutText, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 8, marginTop: -4, marginBottom: 8 },

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

  readingRow: { paddingVertical: 14, paddingHorizontal: 16 },
  readingLabel: { fontSize: 15, color: S.rowText, marginBottom: 10 },
  readingDivider: { height: 1, backgroundColor: S.dropDivider },
  segRow: { flexDirection: 'row', gap: 6 },
  segPill: { flex: 1, paddingVertical: 8, borderWidth: 1, borderRadius: 10, alignItems: 'center' },
  segText: { fontSize: 13 },
  previewCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: S.cardBorder,
    borderRadius: 14,
    backgroundColor: palette.cardAlt,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  previewEyebrow: { fontSize: 11, letterSpacing: 1, fontWeight: '600', marginBottom: 9 },
  previewAct: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14.5, fontWeight: '600', lineHeight: 22, marginBottom: 7 },
  previewBeat: { fontSize: 13, lineHeight: 23 },

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
