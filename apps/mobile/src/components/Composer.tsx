// 输入栏:自由输入 + 回车/按钮发送(system-design §2.1「流式对话」)。
// 视觉:圆角胶囊输入框 + 右侧圆形发送按钮(↑),贴底,留出安全区。

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: palette.pageBg, paddingBottom: insets.bottom + 10 },
      ]}
    >
      <View style={[styles.inputWrap, { backgroundColor: palette.cardBg, borderColor: palette.border }]}>
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? '写下你的想法…'}
          placeholderTextColor={palette.textSecondaryAlt}
          multiline
          // 回车发送(系统设计:回车发送)。
          onSubmitEditing={submit}
          blurOnSubmit={false}
          editable={!busy}
        />
      </View>
      <Pressable
        style={[styles.send, { backgroundColor: busy ? palette.textSecondaryAlt : palette.sendBg }]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="发送"
      >
        <Text style={styles.sendArrow}>↑</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  inputWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 26,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  input: {
    maxHeight: 120,
    fontSize: 16,
    lineHeight: 22,
    paddingTop: 0,
    paddingBottom: 0,
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendArrow: { color: '#fff', fontSize: 24, lineHeight: 28, fontWeight: '500' },
});
