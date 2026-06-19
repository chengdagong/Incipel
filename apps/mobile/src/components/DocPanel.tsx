// 剧本文档面板:从底部滑出的浮层(对齐原型「编剧助手 原型.dc.html」DOCUMENT PANEL,见 issue #11)。
// 累积的剧本全文随对话实时更新;世界观/人物/大纲/分场分区,人物区可左右滑动,空分区显示虚线占位。
//
// 与原型差异:导出(Fountain/PDF)按 system-design §15 移出 v1,略去;人物卡的肖像(#14)与
// 属性级聚焦(#12)留作后续,本轮先做面板骨架 + 人物名/小传 + 左右滑动。

import { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Character, type CharacterAttr, type Screenplay } from '@incipel/shared';
import { defaultTheme, type Theme } from '../theme';
import { useT } from '../i18n';
import { PortraitThumb } from './PortraitThumb';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// 原型 doc 面板专用配色(literal,逐像素对齐)。
const DOC = {
  sheetBg: '#FBFAF7',
  eyebrow: '#B3AEA4',
  collapse: '#9A958C',
  title: '#2A2825',
  logline: '#7C776E',
  pending: '#C2BDB3',
  body: '#54504A',
  charName: '#2A2825',
  charRole: '#A39E94',
  charNote: '#3A352F',
  swipeHint: '#B6B0A6',
  outline: '#6E6960',
  sceneSlug: '#A39E94',
  sceneBorder: '#EDEAE3',
  dashed: '#DBD5CB',
  divider: '#F0EDE7',
  noteBg: '#F5F2EC',
  noteText: '#9A958C',
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
  screenplay: Screenplay;
  theme?: Theme;
  // 点人物卡「聊聊 TA」:聚焦整个人物。
  onFocusCharacter?: (character: Character) => void;
  // 点某条属性:聚焦该属性(#12 聚焦标签)。
  onFocusAttr?: (character: Character, attr: CharacterAttr) => void;
};

export function DocSheet({
  open,
  onClose,
  screenplay,
  theme = defaultTheme,
  onFocusCharacter,
  onFocusAttr,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { accent } = theme;
  const t = useT();

  // translateY:开 0 / 关 height(滑出屏下)。初值取当前 open,避免 view=doc 进入时多一次滑动。
  const anim = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: open ? 340 : 280,
      useNativeDriver: true,
    }).start();
  }, [open, anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });

  const { meta, world, characters, outline, scenes } = screenplay;
  const title = meta.title?.trim() || t('untitled');

  return (
    <Animated.View
      style={[styles.sheet, { transform: [{ translateY }] }]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* 顶栏:eyebrow + 收起 */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.eyebrow}>{t('draftAuto')}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.collapse}>{t('collapse')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]}>
        <Text style={styles.docTitle}>《{title}》</Text>
        {meta.logline?.trim() ? (
          <Text style={[styles.logline, { borderLeftColor: accent }]}>{meta.logline}</Text>
        ) : (
          <Text style={styles.pending}>{t('loglinePending')}</Text>
        )}

        {/* 世界观 · 设定 */}
        <SectionLabel accent={accent} text={t('secWorld')} />
        {world.length > 0 ? (
          <View style={styles.worldBlock}>
            {world.map((w) => (
              <View key={w.id} style={styles.worldSection}>
                {!!w.title && <Text style={styles.worldTitle}>{w.title}</Text>}
                {!!w.text && <Text style={styles.bodyText}>{w.text}</Text>}
              </View>
            ))}
          </View>
        ) : (
          <EmptyHint text={t('worldEmpty')} />
        )}

        {/* 人物 · 左右滑动 */}
        <View style={styles.charsHeader}>
          <Text style={[styles.sectionLabel, { color: accent }]}>
            {t('secChars')} <Text style={styles.charCount}>· {characters.length}</Text>
          </Text>
          {characters.length > 1 && <Text style={styles.swipeHint}>{t('swipeHint')}</Text>}
        </View>
        {characters.length > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={[styles.charScroller, { width, marginLeft: -26 }]}
            contentContainerStyle={{ alignItems: 'flex-start' }}
          >
            {characters.map((c) => (
              <View key={c.id} style={[styles.charCard, { width }]}>
                <View style={styles.charRow}>
                  <PortraitThumb character={c} />
                  <View style={styles.charInfo}>
                    <Text style={styles.charName}>{c.name || '未命名角色'}</Text>
                    {!!c.role && <Text style={styles.charRole}>{c.role}</Text>}
                    {c.attrs.length > 0 && (
                      <View style={styles.attrList}>
                        {c.attrs.map((a) => (
                          <Pressable
                            key={a.id}
                            onPress={onFocusAttr ? () => onFocusAttr(c, a) : undefined}
                            style={({ pressed }) => [styles.attrRow, pressed && styles.attrRowPressed]}
                            accessibilityRole="button"
                          >
                            <Text style={styles.attrLabel}>{a.label}</Text>
                            <Text style={styles.attrValue}>{a.value}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {!!onFocusCharacter && (
                      <Pressable onPress={() => onFocusCharacter(c)} hitSlop={6}>
                        <Text style={[styles.charAction, { color: accent }]}>聊聊 TA →</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        ) : (
          <EmptyHint text={t('charsEmpty')} />
        )}

        {/* 大纲 */}
        <SectionLabel accent={accent} text={t('secOutline')} />
        {outline.length > 0 ? (
          <View style={styles.outlineBlock}>
            {outline.map((a) => (
              <Text key={a.id} style={styles.outlineItem}>
                <Text style={styles.outlineAct}>{a.act}</Text>
                {a.beat ? ` · ${a.beat}` : ''}
              </Text>
            ))}
          </View>
        ) : (
          <EmptyHint text={t('outlineEmpty')} />
        )}

        {/* 分场 · 对白 */}
        <SectionLabel accent={accent} text={t('secScenes')} />
        {scenes.length > 0 ? (
          <View style={styles.sceneBlock}>
            {scenes.map((s) => (
              <View key={s.id} style={styles.scene}>
                <Text style={styles.sceneSlug}>{s.slug}</Text>
                {!!s.content && <Text style={styles.sceneContent}>{s.content}</Text>}
              </View>
            ))}
          </View>
        ) : (
          <EmptyHint text={t('scenesEmpty')} last />
        )}

        <View style={styles.liveNote}>
          <Text style={styles.liveNoteText}>{t('docLiveNote')}</Text>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

function SectionLabel({ accent, text }: { accent: string; text: string }) {
  return <Text style={[styles.sectionLabel, { color: accent }]}>{text}</Text>;
}

function EmptyHint({ text, last }: { text: string; last?: boolean }) {
  return (
    <Text style={[styles.emptyHint, last ? styles.emptyHintLast : styles.emptyHintDashed]}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  sheet: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: DOC.sheetBg,
    shadowColor: '#322C26',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: DOC.divider,
  },
  eyebrow: { fontSize: 11, letterSpacing: 2, color: DOC.eyebrow, textTransform: 'uppercase' },
  collapse: { fontSize: 15, color: DOC.collapse },

  content: { paddingHorizontal: 26, paddingTop: 24 },
  docTitle: {
    fontFamily: defaultTheme.fonts.serifTitle,
    fontSize: 24,
    fontWeight: '600',
    color: DOC.title,
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  logline: {
    fontSize: 13.5,
    color: DOC.logline,
    lineHeight: 23,
    marginBottom: 26,
    paddingLeft: 12,
    borderLeftWidth: 2,
  },
  pending: { fontSize: 13, color: DOC.pending, marginBottom: 26 },

  sectionLabel: { fontSize: 11, letterSpacing: 1, fontWeight: '600', marginBottom: 12 },
  charCount: { color: '#C2BDB3', fontWeight: '400' },

  worldBlock: { marginBottom: 28, gap: 14 },
  worldSection: { gap: 4 },
  worldTitle: { fontSize: 14, fontWeight: '600', color: DOC.title },
  bodyText: { fontSize: 13, color: DOC.body, lineHeight: 23 },

  charsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  swipeHint: { fontSize: 11, color: DOC.swipeHint },
  charScroller: { marginBottom: 28 },
  charCard: {},
  charRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 26 },
  charInfo: { flex: 1, gap: 4 },
  charName: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 16, fontWeight: '600', color: DOC.charName },
  charRole: { fontSize: 12, color: DOC.charRole, marginBottom: 3 },
  attrList: { marginTop: 4 },
  attrRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  attrRowPressed: { backgroundColor: '#F6F1E9' },
  attrLabel: { width: 44, fontSize: 13, lineHeight: 22, color: DOC.charRole },
  attrValue: { flex: 1, fontSize: 13, lineHeight: 22, color: DOC.charNote },
  charAction: { fontSize: 12.5, fontWeight: '600', marginTop: 6 },

  outlineBlock: { marginBottom: 28, gap: 11 },
  outlineItem: { fontSize: 13, color: DOC.outline, lineHeight: 21 },
  outlineAct: { color: '#2A2825', fontWeight: '700' },

  sceneBlock: { marginBottom: 24, gap: 18 },
  scene: { borderLeftWidth: 2, borderLeftColor: DOC.sceneBorder, paddingLeft: 14 },
  sceneSlug: { fontSize: 11, letterSpacing: 1, color: DOC.sceneSlug, marginBottom: 8, fontFamily: MONO },
  sceneContent: { fontSize: 12.5, color: DOC.body, lineHeight: 22, fontFamily: MONO },

  emptyHint: { fontSize: 13, color: DOC.pending },
  emptyHintDashed: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: DOC.dashed,
    paddingBottom: 14,
    marginBottom: 28,
  },
  emptyHintLast: { paddingBottom: 14, marginBottom: 24 },

  liveNote: { marginTop: 14, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: DOC.noteBg, borderRadius: 12 },
  liveNoteText: { fontSize: 12, color: DOC.noteText, lineHeight: 19 },
});
