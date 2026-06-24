// 输入栏:单卡式圆角容器,内含「聚焦标签行 / 输入行 / 底部控件行」,贴底留安全区。
// 视觉严格对齐最新 handoff 原型「composer」:边框胶囊 radius24,底部一排 [＋] [思考 pill] … [发送↑]。
// 聚焦标签(#12):有 chip 时即使正文为空也能发送,边框转主色、占位文案变体;chip 拼进消息由上层完成。
//
// 说明:
// - 发送 / 聚焦标签 = 真功能。
// - 「思考」pill = 本地档位(快速 / 平衡 / 深入),点一下循环切换;暂未接进 agent 生成参数。
// - 「＋」= 附件 / 菜单位,占位呈现(对齐原型),功能后续接入。

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defaultTheme, type Theme } from '../theme';
import type { FocusChip } from '../focus';
import { THINK_I18N, useI18n } from '../i18n';

export type ComposerHandle = { focus: () => void };

type ThinkMode = 'fast' | 'balanced' | 'deep';

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
  const { palette, accent, accentSoft, accentSoftBorder } = theme;
  const { t, lang } = useI18n();
  const think = THINK_I18N[lang];
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [thinkMode, setThinkMode] = useState<ThinkMode>('balanced');
  const inputRef = useRef<TextInput>(null);

  // 点属性/人物加 chip 时,上层会调用 focus() 把光标放到输入框(对应原型)。
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const hasChips = chips.length > 0;
  const canSend = (!!text.trim() || hasChips) && !busy;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  }

  function cycleThink() {
    setThinkMode((m) => (m === 'fast' ? 'balanced' : m === 'balanced' ? 'deep' : 'fast'));
  }

  return (
    <View
      style={[styles.bar, { backgroundColor: palette.pageBg, paddingBottom: insets.bottom + 16 }]}
    >
      <View
        style={[styles.box, { backgroundColor: palette.cardBg, borderColor: hasChips ? accent : palette.border }]}
      >
        {hasChips && (
          <View style={styles.chipRow}>
            {chips.map((ch) => (
              <View
                key={ch.key}
                style={[styles.chip, { backgroundColor: accentSoft, borderColor: accentSoftBorder }]}
              >
                <Text style={[styles.chipKind, { color: accent }]}>{ch.kind} · </Text>
                <Text style={[styles.chipTag, { color: accent }]}>{ch.tag}</Text>
                <Pressable
                  onPress={() => onRemoveChip?.(ch.key)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('remove')}
                  style={styles.chipXBtn}
                >
                  <Text style={[styles.chipX, { color: accent }]}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: palette.textPrimaryAlt }]}
            value={text}
            onChangeText={setText}
            placeholder={hasChips ? t('composerPlaceholderChips') : t('composerPlaceholder')}
            placeholderTextColor={palette.placeholder}
            multiline
            onSubmitEditing={submit}
            blurOnSubmit={false}
            editable={!busy}
          />
        </View>

        <View style={styles.controls}>
          {/* ＋ 附件 / 菜单位(占位,对齐原型)。 */}
          <Pressable
            style={[styles.iconBtn, { backgroundColor: palette.controlBg, borderColor: palette.borderCard }]}
            accessibilityRole="button"
            accessibilityLabel="添加"
          >
            <Text style={[styles.plus, { color: palette.textSecondary }]}>＋</Text>
          </Pressable>

          {/* 「思考」档位 pill:点一下循环切换(本地档位)。 */}
          <Pressable
            onPress={cycleThink}
            style={[styles.thinkPill, { backgroundColor: palette.controlBg, borderColor: palette.borderCard }]}
            accessibilityRole="button"
            accessibilityLabel={think[thinkMode]}
          >
            <View style={[styles.thinkDot, { backgroundColor: accent }]} />
            <Text style={[styles.thinkLabel, { color: palette.textPrimaryAlt }]}>{think[thinkMode]}</Text>
            <Text style={[styles.thinkCaret, { color: palette.placeholder }]}>⌄</Text>
          </Pressable>

          <View style={styles.spacer} />

          <Pressable
            style={[styles.send, { backgroundColor: accent, opacity: canSend ? 1 : 0.35 }]}
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="发送"
            testID="composer-send"
          >
            <Text style={styles.sendArrow}>↑</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // 原型 padding:8px 14px 16px。
  bar: { paddingHorizontal: 14, paddingTop: 8 },
  box: {
    borderWidth: 1.5,
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 9,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 7,
    paddingLeft: 9,
    paddingRight: 5,
    paddingVertical: 3,
  },
  chipKind: { fontSize: 12, fontWeight: '500', opacity: 0.55 },
  chipTag: { fontSize: 12, fontWeight: '600' },
  chipXBtn: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  chipX: { fontSize: 13, lineHeight: 14 },

  inputRow: { paddingHorizontal: 10, paddingTop: 7, paddingBottom: 6 },
  input: { maxHeight: 120, fontSize: 15, lineHeight: 20, padding: 0, margin: 0 },

  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingTop: 2 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: { fontSize: 17, lineHeight: 19 },
  thinkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  thinkDot: { width: 5, height: 5, borderRadius: 2.5 },
  thinkLabel: { fontSize: 12.5, fontWeight: '600' },
  thinkCaret: { fontSize: 10 },
  spacer: { flex: 1 },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendArrow: { color: '#fff', fontSize: 15, lineHeight: 18, fontWeight: '500' },
});
