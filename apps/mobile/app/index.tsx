// 欢迎屏:灵感输入框、🎲 调 /logline、方向建议 chip、开始创作(system-design §2.1「欢迎页」)。

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authHeaders, loglineEndpoint, newThreadId } from '../src/agui/client';
import { defaultTheme } from '../src/theme';

// 方向建议 chip(静态示例;真实可由 agent 给,v1 先内置几个常见类型)。
const DIRECTION_CHIPS = ['悬疑', '科幻', '爱情', '家庭', '黑色幽默', '历史'];

export default function WelcomeScreen() {
  const router = useRouter();
  const { palette } = defaultTheme;
  const [idea, setIdea] = useState('');
  const [rolling, setRolling] = useState(false);

  // 🎲 调 /logline:便宜模型一次性 completion,把生成的 logline 填入输入框(system-design §10)。
  async function rollLogline() {
    if (rolling) return;
    setRolling(true);
    try {
      const res = await fetch(loglineEndpoint(), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ idea: idea.trim() }),
      });
      // TODO:按 /logline 端点的最终响应形状解析(契约假设:{ logline: string })。
      const data = (await res.json()) as { logline?: string };
      if (data.logline) setIdea(data.logline);
    } catch (e) {
      console.warn('[logline] 生成失败:', e);
      // TODO:给用户明确的「重试」提示(system-design §11:不编造内容)。
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
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.pageBg }]}>
      <Text style={[styles.headline, { color: palette.textPrimary }]}>给我一个灵感</Text>
      <Text style={[styles.sub, { color: palette.textSecondary }]}>
        一句话、一个画面,或者一种说不清的感觉。
      </Text>

      <View style={[styles.inputBox, { backgroundColor: palette.cardBg, borderColor: palette.border }]}>
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          value={idea}
          onChangeText={setIdea}
          placeholder="例如:一个总也送不出去的快递员…"
          placeholderTextColor={palette.textSecondaryAlt}
          multiline
        />
        <Pressable style={styles.dice} onPress={rollLogline} accessibilityRole="button">
          {rolling ? <ActivityIndicator color={defaultTheme.accent} /> : <Text style={styles.diceLabel}>🎲</Text>}
        </Pressable>
      </View>

      <View style={styles.chips}>
        {DIRECTION_CHIPS.map((c) => (
          <Pressable
            key={c}
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
          { backgroundColor: idea.trim() ? defaultTheme.accent : palette.textSecondaryAlt },
        ]}
        onPress={start}
        disabled={!idea.trim()}
        accessibilityRole="button"
      >
        <Text style={styles.startLabel}>开始创作</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, gap: 16, justifyContent: 'center' },
  headline: { fontSize: 28, fontWeight: '700' },
  sub: { fontSize: 15, lineHeight: 22 },
  inputBox: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'flex-start' },
  input: { flex: 1, minHeight: 80, fontSize: 16, lineHeight: 24 },
  dice: { paddingHorizontal: 8, paddingTop: 4 },
  diceLabel: { fontSize: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  chipLabel: { fontSize: 13 },
  startBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  startLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
