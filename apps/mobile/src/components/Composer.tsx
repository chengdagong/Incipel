// 输入栏:自由输入 + 回车/按钮发送(system-design §2.1「流式对话」)。
// 视觉:圆角胶囊输入框 + 右侧圆形发送按钮(↑),贴底,留出安全区。
// 聚焦标签(#12):输入框上方可挂若干 focus chip;有 chip 时即使正文为空也能发送,
// 边框转主色、占位文案变体。chip 的「拼进消息」由上层(chat.tsx)在 onSend 时完成。

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defaultTheme, type Theme } from '../theme';
import type { FocusChip } from '../focus';
import { useT } from '../i18n';

export type ComposerHandle = { focus: () => void };

type Props = {
  theme?: Theme;
  // 是否正在流式回复(禁用发送)。
  busy?: boolean;
  onSend: (text: string) => void;
  // 聚焦标签(瞬时);为空数组时不显示 chip 行。
  chips?: FocusChip[];
  onRemoveChip?: (key: string) => void;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { theme = defaultTheme, busy, onSend, chips = [], onRemoveChip },
  ref,
) {
  const { palette } = theme;
  const t = useT();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  // 点属性/人物加 chip 时,上层会调用 focus() 把光标落到输入框(对齐原型)。
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const hasChips = chips.length > 0;
  const canSend = (!!text.trim() || hasChips) && !busy;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <View style={[styles.bar, { backgroundColor: palette.pageBg, paddingBottom: insets.bottom + 10 }]}>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: palette.cardBg, borderColor: hasChips ? theme.accent : palette.border },
        ]}
      >
        {hasChips && (
          <View style={styles.chipRow}>
            {chips.map((ch) => (
              <View key={ch.key} style={[styles.chip, { borderColor: '#EAD2C2' }]}>
                <Text style={[styles.chipKind, { color: theme.accent }]}>{ch.kind} · </Text>
                <Text style={[styles.chipTag, { color: theme.accent }]}>{ch.tag}</Text>
                <Pressable
                  onPress={() => onRemoveChip?.(ch.key)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('remove')}
                >
                  <Text style={[styles.chipX, { color: theme.accent }]}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: palette.textPrimary }]}
          value={text}
          onChangeText={setText}
          placeholder={hasChips ? t('composerPlaceholderChips') : t('composerPlaceholder')}
          placeholderTextColor={palette.placeholder}
          multiline
          // 回车发送(系统设计:回车发送)。
          onSubmitEditing={submit}
          blurOnSubmit={false}
          editable={!busy}
        />
      </View>
      <Pressable
        style={[styles.send, { backgroundColor: canSend ? palette.sendBg : palette.disabledFill }]}
        onPress={submit}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="发送"
        testID="composer-send"
      >
        {/* 启用态:深色箭头压在浅桃底上(白箭头在 #E7C6AF 上只有 ~1.6:1,几乎不可见)。
            禁用态:维持低对比的浅色箭头,读作「不可用」。 */}
        <Text style={[styles.sendArrow, { color: canSend ? palette.textPrimary : '#fff' }]}>↑</Text>
      </Pressable>
    </View>
  );
});

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
    borderWidth: 1.5,
    borderRadius: 22,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 4, paddingBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FBF0E8',
    borderWidth: 1,
    borderRadius: 7,
    paddingLeft: 9,
    paddingRight: 5,
    paddingVertical: 3,
  },
  chipKind: { fontSize: 12, fontWeight: '500', opacity: 0.6 },
  chipTag: { fontSize: 12, fontWeight: '600' },
  chipX: { fontSize: 14, lineHeight: 14, fontWeight: '600', paddingHorizontal: 2 },
  input: {
    maxHeight: 120,
    fontSize: 16,
    lineHeight: 22,
    paddingTop: 6,
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
