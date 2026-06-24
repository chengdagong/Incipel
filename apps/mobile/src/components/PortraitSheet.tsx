// 人物肖像生成底部弹窗(issue #14)。视觉按原型 portraitOpen 还原。
// 真实生图在 v1 之外:点「生成」走 store 的占位流程(loading→done),不接后端、不写剧本。
//
// 弹窗自身从 usePortrait() 读 sheetChar(为 null 即隐藏),无需上层传 props。

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildPortraitPrompt, usePortrait, type PortraitStyle } from '../portrait';
import { useT, type TKey } from '../i18n';
import { defaultTheme, palette } from '../theme';

const STYLE_OPTIONS: { key: PortraitStyle; tkey: TKey }[] = [
  { key: 'cinematic', tkey: 'styleCinematic' },
  { key: 'illustration', tkey: 'styleIllustration' },
  { key: 'lineart', tkey: 'styleLineart' },
  { key: 'watercolor', tkey: 'styleWatercolor' },
];

// 表面 / 描边照搬原型字面值(经 palette 统一);文字灰阶取 AA 档(sub / rewrite / close / chip / cancel)。
const P = {
  overlay: palette.sheetScrim, // rgba(40,35,30,.42)
  panel: palette.cardBg, // #fff
  handle: palette.border, // #E2DDD4
  divider: palette.dividerSheet, // #F1ECE4
  title: palette.textPrimary,
  sub: palette.textSecondary, // 原型 #A39E94(不达 AA),取 AA
  inputBorder: palette.border,
  inputBg: palette.pageBg, // #FBFAF7
  inputText: palette.textPrimaryAlt,
  chipOffBg: palette.chipTrackBg, // #F2EDE5
  chipOffText: palette.textSecondary,
  cancelBorder: palette.border,
  cancelText: palette.textSecondary,
  genBg: palette.avatarBg, // #2A2825
  close: palette.textSecondary,
} as const;

export function PortraitSheet() {
  const { sheetChar, closeSheet, generate, statusOf } = usePortrait();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { accent } = defaultTheme;

  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<PortraitStyle>('cinematic');

  // 打开某人物时:提示词由属性预填,风格沿用其已有选择(否则默认)。
  useEffect(() => {
    if (sheetChar) {
      setPrompt(buildPortraitPrompt(sheetChar));
      setStyle(statusOf(sheetChar.id).style);
    }
  }, [sheetChar, statusOf]);

  return (
    <Modal visible={!!sheetChar} transparent animationType="slide" onRequestClose={closeSheet}>
      <Pressable style={styles.overlay} onPress={closeSheet}>
        {/* 面板:阻止点击冒泡到遮罩 */}
        <Pressable style={[styles.panel, { paddingBottom: insets.bottom + 24 }]} onPress={() => {}}>
          {/* 把手条 */}
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          {/* 标题区 */}
          <View style={styles.titleRow}>
            <View style={styles.titleMain}>
              <Text style={styles.title}>{t('portraitTitle', { name: sheetChar?.name ?? '' })}</Text>
              <Text style={styles.sub}>{t('portraitSub')}</Text>
            </View>
            <Pressable onPress={closeSheet} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('cancel')}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {/* 提示词 */}
          <View style={styles.body}>
            <View style={styles.promptLabelRow}>
              <Text style={[styles.promptLabel, { color: accent }]}>{t('promptLabel')}</Text>
              <Pressable
                onPress={() => sheetChar && setPrompt(buildPortraitPrompt(sheetChar))}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text style={styles.rewrite}>{t('rewriteBtn')}</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.promptInput}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              placeholderTextColor={P.sub}
            />

            {/* 风格四选一 */}
            <Text style={[styles.styleLabel, { color: accent }]}>{t('styleLabel')}</Text>
            <View style={styles.styleRow}>
              {STYLE_OPTIONS.map((o) => {
                const selected = o.key === style;
                return (
                  <Pressable
                    key={o.key}
                    onPress={() => setStyle(o.key)}
                    style={[
                      styles.styleChip,
                      selected
                        ? { backgroundColor: accent }
                        : { backgroundColor: P.chipOffBg },
                    ]}
                    accessibilityRole="button"
                    testID={`portrait-style-${o.key}`}
                  >
                    <Text style={[styles.styleChipText, { color: selected ? '#fff' : P.chipOffText }]}>
                      {t(o.tkey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 取消 / 生成 */}
          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={closeSheet} accessibilityRole="button">
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              style={styles.genBtn}
              onPress={() => sheetChar && generate(sheetChar.id, style)}
              accessibilityRole="button"
              // E2E:弹窗内「生成」与标题「生成「…」的肖像」文案相撞,用 testID 精确点生成按钮。
              testID="portrait-generate"
            >
              <Text style={styles.genStar}>★</Text>
              <Text style={styles.genText}>{t('generate')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: P.overlay, justifyContent: 'flex-end' },
  panel: {
    backgroundColor: P.panel,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowColor: '#28231E',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 24,
  },
  handleWrap: { alignItems: 'center', paddingTop: 9, paddingBottom: 2 },
  handle: { width: 38, height: 4, borderRadius: 3, backgroundColor: P.handle },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: P.divider,
  },
  titleMain: { flex: 1, minWidth: 0 },
  title: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 17, fontWeight: '600', color: P.title },
  sub: { fontSize: 12, color: P.sub, marginTop: 2 },
  close: { fontSize: 19, lineHeight: 19, color: P.close, padding: 2 },

  body: { paddingHorizontal: 22, paddingTop: 16 },
  promptLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  promptLabel: { fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  rewrite: { fontSize: 11.5, color: P.sub, fontWeight: '600' },
  promptInput: {
    minHeight: 92,
    borderWidth: 1.5,
    borderColor: P.inputBorder,
    borderRadius: 13,
    backgroundColor: P.inputBg,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 22,
    color: P.inputText,
    textAlignVertical: 'top',
  },

  styleLabel: { fontSize: 11, letterSpacing: 1, fontWeight: '600', marginTop: 16, marginBottom: 9 },
  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  styleChip: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 },
  styleChipText: { fontSize: 12.5, fontWeight: '600' },

  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', paddingHorizontal: 22, paddingTop: 16 },
  cancelBtn: {
    borderWidth: 1,
    borderColor: P.cancelBorder,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  cancelText: { fontSize: 13, color: P.cancelText, fontWeight: '600' },
  genBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: P.genBg,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  genStar: { color: '#fff', fontSize: 13 },
  genText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
