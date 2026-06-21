// 人物卡上的肖像缩略块(issue #14),三态:空占位 / 绘制中 / 已生成(占位色 + 名字首字)。
// 文档面板与内联卡片共用。点空占位或右下角 ↻ → 打开生成弹窗(usePortrait().openSheet)。
//
// 真实生图在 v1 之外:已生成态用纯色占位 + 名字首字呈现(见 portrait.tsx)。
// 无 react-native-svg:spinner 用 Animated 转一个圆环 View;图标用字形(＋ / ↻)。

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Character } from '@incipel/shared';
import { portraitColor, usePortrait } from '../portrait';
import { useT } from '../i18n';
import { defaultTheme } from '../theme';

const W = 96;
const H = 124;

export function PortraitThumb({ character }: { character: Character }) {
  const { statusOf, openSheet } = usePortrait();
  const t = useT();
  const { accent } = defaultTheme;
  const p = statusOf(character.id);
  const open = () => openSheet(character);
  const mono = (character.name || '?').trim().charAt(0) || '?';

  if (p.status === 'loading') {
    return (
      <View style={[styles.box, styles.loadingBox]}>
        <Spinner accent={accent} />
        <Text style={styles.drawing}>{t('drawing')}</Text>
      </View>
    );
  }

  if (p.status === 'done') {
    return (
      <View style={[styles.box, { backgroundColor: portraitColor(character.name, p.style) }]}>
        <Text style={styles.mono}>{mono}</Text>
        {/* 底部压暗叠层(近似原型 inset 阴影)。 */}
        <View style={styles.dim} pointerEvents="none" />
        <Pressable
          style={styles.regen}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t('regenTitle')}
          hitSlop={12}
        >
          <Text style={[styles.regenIcon, { color: accent }]}>↻</Text>
        </Pressable>
      </View>
    );
  }

  // empty
  return (
    <Pressable
      style={({ pressed }) => [styles.box, styles.emptyBox, pressed && { borderColor: accent }]}
      onPress={open}
      accessibilityRole="button"
    >
      <Text style={[styles.plus, { color: accent }]}>＋</Text>
      <Text style={[styles.genLabel, { color: accent }]}>{t('genPortrait')}</Text>
    </Pressable>
  );
}

function Spinner({ accent }: { accent: string }) {
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
    <Animated.View style={[styles.ring, { borderTopColor: accent, transform: [{ rotate }] }]} />
  );
}

const styles = StyleSheet.create({
  box: { width: W, height: H, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  emptyBox: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D3CCC0', backgroundColor: '#F5F1EA', gap: 8 },
  plus: { fontSize: 26, lineHeight: 28 },
  genLabel: { fontSize: 11, fontWeight: '600' },

  loadingBox: { backgroundColor: '#F2EDE5', gap: 10 },
  ring: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: '#E7DECF' },
  drawing: { fontSize: 10.5, color: '#A39E94' },

  mono: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 42, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  dim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 48, backgroundColor: 'rgba(0,0,0,0.28)' },
  regen: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regenIcon: { fontSize: 12, lineHeight: 14 },
});
