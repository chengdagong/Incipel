// 欢迎屏:灵感输入框、🎲 调 /logline、方向建议 chip、开始创作(system-design §2.1「欢迎页」)。

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
import { useT } from '../../src/i18n';
import { defaultTheme } from '../../src/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawer = useDrawer();
  const t = useT();
  const { palette } = defaultTheme;
  // 方向建议 chip(静态示例;真实可由 agent 给,v1 先内置几个常见类型)。
  const DIRECTION_CHIPS = [t('sug1'), t('sug2'), t('sug3')];
  const [idea, setIdea] = useState('');
  const [ideaFocused, setIdeaFocused] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  // 骰子旋转(每次点一圈,对齐原型 diceSpin)。
  const spin = useRef(new Animated.Value(0)).current;
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // 🎲 调 /logline:便宜模型一次性 completion,把生成的 logline 填入输入框(system-design §10)。
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
      // 非 2xx(后端 401/404/502 等)也会带 JSON,这里先判状态,避免把错误体当正常结果静默吞掉。
      if (!res.ok) throw new Error(`服务返回 ${res.status}`);
      // 契约假设:{ logline: string }。
      const data = (await res.json()) as { logline?: string };
      if (!data.logline) throw new Error('未返回 logline');
      setIdea(data.logline);
    } catch (e) {
      console.warn('[logline] 生成失败:', e);
      // 给用户明确反馈,而非毫无反应(system-design §11:不编造内容)。
      setRollError('没能生成,请稍后再试。');
    } finally {
      setRolling(false);
    }
  }

  // 「开始创作」:现生成一个 threadId(= 会话 id)并跳到对话屏,带上灵感作为首条消息
  //(chat 屏挂载时用 useScreenplayAgent(threadId) 建连接并发出首轮,system-design §10)。
  // documents / sessions 行由 agent 端在首轮里按 threadId 建立(system-design §6.2);客户端不直接写库。
  function start() {
    router.push({ pathname: '/chat', params: { idea: idea.trim(), threadId: newThreadId() } });
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg }]}>
      {/* 页内顶栏:左上汉堡唤出侧边抽屉(对齐原型欢迎页)。 */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <MenuButton variant="circle" onPress={drawer.open} />
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.eyebrow, { color: palette.textSecondary }]}>{t('eyebrow')}</Text>
        <Text style={[styles.headline, { color: palette.textPrimary }]}>{t('welcomeTitle')}</Text>
      <Text style={[styles.sub, { color: palette.textSecondary }]}>{t('welcomeSub')}</Text>

      <View
        style={[
          styles.inputBox,
          { backgroundColor: '#fff', borderColor: ideaFocused ? defaultTheme.accent : palette.border },
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
          style={styles.dice}
          onPress={rollLogline}
          disabled={rolling}
          accessibilityRole="button"
          accessibilityLabel={t('diceTitle')}
          testID="welcome-dice"
          hitSlop={10}
        >
          {rolling ? (
            <ActivityIndicator color={defaultTheme.accent} />
          ) : (
            <Animated.Text style={[styles.diceLabel, { transform: [{ rotate: spinDeg }] }]}>🎲</Animated.Text>
          )}
        </Pressable>
      </View>

      {!!rollError && <Text style={[styles.rollError, { color: palette.danger }]}>{rollError}</Text>}

      <Text style={[styles.suggestHint, { color: palette.textSecondary }]}>{t('suggestHint')}</Text>
      <View style={styles.chips}>
        {DIRECTION_CHIPS.map((c, i) => (
          <Pressable
            key={c}
            testID={`welcome-chip-${i}`}
            style={[styles.chip, { borderColor: palette.border, backgroundColor: palette.cardBg }]}
            onPress={() => setIdea((prev) => (prev ? `${prev}（${c}）` : c))}
          >
            <Text style={[styles.chipLabel, { color: palette.textSecondary }]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[
          styles.startBtn,
          { backgroundColor: idea.trim() ? defaultTheme.accent : palette.disabledFill },
        ]}
        onPress={start}
        disabled={!idea.trim()}
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
  topBar: { paddingHorizontal: 20, paddingBottom: 4, flexDirection: 'row', alignItems: 'center' },
  container: { flexGrow: 1, padding: 24, gap: 16, justifyContent: 'center' },
  eyebrow: { fontSize: 12, letterSpacing: 3, textTransform: 'uppercase' },
  headline: {
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 40,
    letterSpacing: -0.2,
    fontFamily: defaultTheme.fonts.serifTitle,
  },
  sub: { fontSize: 14.5, lineHeight: 24 },
  suggestHint: { fontSize: 12 },
  inputBox: { borderWidth: 1.5, borderRadius: 18, paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16 },
  input: { minHeight: 84, fontSize: 14.5, lineHeight: 24, paddingRight: 34 },
  dice: { position: 'absolute', right: 12, bottom: 11, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  diceLabel: { fontSize: 18, lineHeight: 20 },
  rollError: { fontSize: 13, marginTop: -8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipLabel: { fontSize: 12.5 },
  startBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  startLabel: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
