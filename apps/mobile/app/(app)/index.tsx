// 欢迎屏:灵感输入框、🎲 调 logline、题材单选 chip、开始创作。视觉对齐最新 handoff 原型「WELCOME」屏。
// 布局:汉堡顶栏在上,内容 + 开始按钮贴底(原型 margin-bottom:auto 把内容压到下半屏)。

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authHeaders, loglineEndpoint, newThreadId } from '../../src/agui/client';
import { MenuButton } from '../../src/components/Drawer';
import { useDrawer } from '../../src/drawer/DrawerProvider';
import { GENRE_I18N, useI18n } from '../../src/i18n';
import { defaultTheme } from '../../src/theme';

const { palette, accent, accentSoft, fonts } = defaultTheme;

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawer = useDrawer();
  const { t, lang } = useI18n();
  const genre = GENRE_I18N[lang];
  const [idea, setIdea] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [ideaFocused, setIdeaFocused] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  // 骰子旋转(每次点一圈,对齐原型 diceSpin)。
  const spin = useRef(new Animated.Value(0)).current;
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // 🎲 调 logline:便宜模型一次性 completion,把生成的 logline 填入输入框(system-design §10)。
  async function rollLogline() {
    if (rolling) return;
    setRolling(true);
    setRollError(null);
    spin.setValue(0);
    Animated.timing(spin, {
      toValue: 1,
      duration: 500,
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      useNativeDriver: true,
    }).start();
    try {
      const res = await fetch(loglineEndpoint(), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`服务返回 ${res.status}`);
      const data = (await res.json()) as { logline?: string };
      if (!data.logline) throw new Error('未返回 logline');
      setIdea(data.logline);
    } catch (e) {
      console.warn('[logline] 生成失败:', e);
      setRollError('没能生成,请稍后再试。');
    } finally {
      setRolling(false);
    }
  }

  // 「开始创作」:生成 threadId 并跳到对话屏,带上灵感(选了题材则按原型折进首条消息)作为首轮。
  function start() {
    const trimmed = idea.trim();
    if (!trimmed) return;
    const firstMsg = selectedGenre ? `${trimmed}\n${genre.marker.replace('{x}', selectedGenre)}` : trimmed;
    router.push({ pathname: '/chat', params: { idea: firstMsg, threadId: newThreadId() } });
  }

  const canStart = !!idea.trim();

  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg }]}>
      {/* 页内顶栏:左上汉堡唤出侧边抽屉。 */}
      <View style={[styles.topBar, { paddingTop: insets.top + 18 }]}>
        <MenuButton variant="circle" onPress={drawer.open} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 26 }]}
        keyboardShouldPersistTaps="always"
      >
        <Text style={[styles.eyebrow, { color: palette.placeholder }]}>{t('eyebrow')}</Text>
        <Text style={[styles.headline, { color: palette.textPrimary }]}>{t('welcomeTitle')}</Text>
        <Text style={[styles.sub, { color: palette.textSecondary }]}>{t('welcomeSub')}</Text>

        <View
          style={[
            styles.inputBox,
            { backgroundColor: palette.cardBg, borderColor: ideaFocused ? accent : palette.border },
          ]}
        >
          <TextInput
            style={[styles.input, { color: palette.textPrimaryAlt }]}
            value={idea}
            onChangeText={setIdea}
            onFocus={() => setIdeaFocused(true)}
            onBlur={() => setIdeaFocused(false)}
            placeholder={t('ideaPlaceholder')}
            placeholderTextColor={palette.placeholder}
            testID="welcome-idea"
            multiline
          />
          <Pressable
            style={[
              styles.dice,
              {
                borderColor: rolling ? accent : palette.borderControl,
                backgroundColor: rolling ? '#FAF6F0' : palette.cardBg,
              },
            ]}
            onPress={rollLogline}
            disabled={rolling}
            accessibilityRole="button"
            accessibilityLabel={t('diceTitle')}
            testID="welcome-dice"
            hitSlop={8}
          >
            {rolling ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <Animated.Text style={[styles.diceLabel, { transform: [{ rotate: spinDeg }] }]}>🎲</Animated.Text>
            )}
          </Pressable>
        </View>

        {!!rollError && <Text style={[styles.rollError, { color: palette.danger }]}>{rollError}</Text>}

        <Text style={[styles.genreTitle, { color: palette.placeholder }]}>{genre.title}</Text>
        <View style={styles.chips}>
          {genre.list.map((g, i) => {
            const on = selectedGenre === g;
            return (
              <Pressable
                key={g}
                testID={`welcome-genre-${i}`}
                style={[
                  styles.chip,
                  on
                    ? { borderColor: accent, backgroundColor: accentSoft }
                    : { borderColor: palette.borderChip, backgroundColor: palette.cardBg },
                ]}
                onPress={() => setSelectedGenre((prev) => (prev === g ? '' : g))}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' },
                  ]}
                >
                  {g}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={[styles.startBtn, { backgroundColor: accent, opacity: canStart ? 1 : 0.4 }]}
          onPress={start}
          disabled={!canStart}
          accessibilityRole="button"
          testID="welcome-start"
        >
          <Text style={styles.startLabel}>{t('startBtn')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { paddingHorizontal: 28, paddingBottom: 4, flexDirection: 'row', alignItems: 'center' },
  // 内容贴底:flexGrow 撑满 + flex-end 把内容压到下半屏(对齐原型 margin-bottom:auto)。
  container: { flexGrow: 1, paddingHorizontal: 28, justifyContent: 'flex-end' },
  eyebrow: { fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 },
  headline: {
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 40,
    letterSpacing: -0.2,
    fontFamily: fonts.serifTitle,
    marginBottom: 14,
  },
  sub: { fontSize: 14.5, lineHeight: 24.5, marginBottom: 22 },
  inputBox: {
    position: 'relative',
    borderWidth: 1.5,
    borderRadius: 18,
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  input: { minHeight: 96, fontSize: 14.5, lineHeight: 24, paddingRight: 30, paddingTop: 0 },
  dice: {
    position: 'absolute',
    right: 12,
    bottom: 11,
    zIndex: 2,
    elevation: 2,
    width: 30,
    height: 30,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceLabel: { fontSize: 16, lineHeight: 18 },
  rollError: { fontSize: 13, marginTop: 8 },
  genreTitle: { fontSize: 12, marginTop: 24, marginBottom: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipLabel: { fontSize: 12.5 },
  startBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 26 },
  startLabel: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
