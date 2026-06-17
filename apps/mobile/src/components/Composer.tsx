// 输入栏:自由输入 + 回车/按钮发送(system-design §2.1「流式对话」)。

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { defaultTheme, type Theme } from '../theme';

type Props = {
  theme?: Theme;
  placeholder?: string;
  // 是否正在流式回复(禁用发送)。
  busy?: boolean;
  onSend: (text: string) => void;
};

export function Composer({ theme = defaultTheme, placeholder, busy, onSend }: Props) {
  const { palette } = theme;
  const [text, setText] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <View style={[styles.bar, { backgroundColor: palette.cardBg, borderColor: palette.border }]}>
      <TextInput
        style={[styles.input, { color: palette.textPrimary }]}
        value={text}
        onChangeText={setText}
        placeholder={placeholder ?? '说点什么…'}
        placeholderTextColor={palette.textSecondaryAlt}
        multiline
        // 回车发送(系统设计:回车发送)。
        onSubmitEditing={submit}
        blurOnSubmit={false}
        editable={!busy}
      />
      <Pressable
        style={[styles.send, { backgroundColor: busy ? palette.textSecondaryAlt : theme.accent }]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.sendLabel}>发送</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    padding: 8,
  },
  input: { flex: 1, maxHeight: 120, paddingHorizontal: 8, paddingVertical: 8, fontSize: 15 },
  send: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  sendLabel: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
