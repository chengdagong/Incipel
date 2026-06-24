// 人物卡上的肖像缩略块(issue #14),三态:空占位 / 绘制中 / 已生成(占位色 + 名字首字)。
// 文档面板与内联卡片共用,两种尺寸:'card' 76×96(内联卡片) / 'detail' 80×100(文档人物详情)。
// 点空占位或右下角 ↻ → 打开生成弹窗(usePortrait().openSheet)。
//
// 真实生图在 v1 之外:已生成态用纯色占位 + 名字首字呈现(见 portrait.tsx)。
// 无 react-native-svg:spinner 用 Animated 转一个圆环 View;图标用字形(＋ / ↻)。

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Character } from '@incipel/shared';
import { portraitColor, usePortrait } from '../portrait';
import { useT } from '../i18n';
import { defaultTheme, palette } from '../theme';

type Variant = 'card' | 'detail';

// 两档尺寸:对齐原型内联卡片(76×96)与文档人物详情(80×100)。
const DIMS = {
  card: { w: 76, h: 96, mono: 30, regen: 19, regenIcon: 10, ring: 24, dim: 26 },
  detail: { w: 80, h: 100, mono: 32, regen: 20, regenIcon: 10, ring: 26, dim: 28 },
} as const;

export function PortraitThumb({ character, variant = 'card' }: { character: Character; variant?: Variant }) {
  const { statusOf, openSheet } = usePortrait();
  const t = useT();
  const { accent } = defaultTheme;
  const d = DIMS[variant];
  const p = statusOf(character.id);
  const open = () => openSheet(character);
  const mono = (character.name || '?').trim().charAt(0) || '?';
  const box = { width: d.w, height: d.h, borderRadius: 12 };

  if (p.status === 'loading') {
    return (
      <View style={[styles.box, box, styles.loadingBox]}>
        <Spinner accent={accent} size={d.ring} />
        <Text style={styles.drawing}>{t('drawing')}</Text>
      </View>
    );
  }

  if (p.status === 'done') {
    return (
      <View style={[styles.box, box, { backgroundColor: portraitColor(character.name, p.style) }]}>
        <Text style={[styles.mono, { fontSize: d.mono }]}>{mono}</Text>
        {/* 底部压暗叠层(近似原型 inset 阴影)。 */}
        <View style={[styles.dim, { height: d.dim }]} pointerEvents="none" />
        <Pressable
          style={[styles.regen, { width: d.regen, height: d.regen, borderRadius: d.regen / 2 }]}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t('regenTitle')}
          hitSlop={12}
        >
          <Text style={[styles.regenIcon, { color: accent, fontSize: d.regenIcon }]}>↻</Text>
        </Pressable>
      </View>
    );
  }

  // empty
  return (
    <Pressable
      style={({ pressed }) => [styles.box, box, styles.emptyBox, pressed && { borderColor: accent }]}
      onPress={open}
      accessibilityRole="button"
      // E2E:同屏多个人物时「生成肖像」文案相同,按人物 id 区分(见 .maestro 套件)。
      testID={`char-portrait-gen-${character.id}`}
    >
      <Text style={[styles.plus, { color: accent }]}>＋</Text>
      <Text style={[styles.genLabel, { color: accent }]}>{t('genPortrait')}</Text>
    </Pressable>
  );
}

function Spinner({ accent, size }: { accent: string; size: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderTopColor: accent, transform: [{ rotate }] }]}
    />
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  emptyBox: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D3CCC0', backgroundColor: palette.portraitEmptyBg, gap: 7 },
  plus: { fontSize: 22, lineHeight: 24 },
  genLabel: { fontSize: 10.5, fontWeight: '600' },

  loadingBox: { backgroundColor: palette.portraitLoadingBg, gap: 8 },
  ring: { borderWidth: 3, borderColor: palette.portraitSpinnerTrack },
  drawing: { fontSize: 10, color: palette.textSecondary },

  mono: { fontFamily: defaultTheme.fonts.serifTitle, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  dim: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.32)' },
  regen: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: palette.regenBtnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regenIcon: { lineHeight: 12 },
});
