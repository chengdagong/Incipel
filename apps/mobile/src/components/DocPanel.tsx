// 剧本文档面板:从底部滑出的浮层(对齐最新 handoff 原型「DOCUMENT PANEL」,见 issue #11)。
// 多卷导航:目录(扉页 + 目录)→ 世界设定 / 人物表 / 人物详情 / 故事节拍 / 剧本正文。
// 累积的剧本全文随对话实时更新;空卷显示占位。人物详情的标签 chip 可点 → 聚焦该属性(#12)。
//
// 与原型差异:
// - 导出(Fountain/PDF)按 system-design §15 移出 v1,这里按原型样式呈现为非交互方框。
// - 原型的「选中段落 → 行内编辑条」「＋ 添加标签」未纳入:改写经既有聚焦标签(点标签 chip)走输入栏。

import { useEffect, useRef, useState } from 'react';
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
import { defaultTheme, palette, type Theme } from '../theme';
import { DOC_I18N, useI18n, VOL_I18N } from '../i18n';
import { badgeBox, charView, splitBeat } from '../charView';
import { PortraitThumb } from './PortraitThumb';
import { ReaderText } from './ReaderText';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace' });
const DOTTED = '#D6CFC3'; // 目录点线引导色

type DocView = 'contents' | 'world' | 'chars' | 'charDetail' | 'beats' | 'script';

// 卡片页脚「打开世界设定 / 人物卡片 / 故事节拍 / 剧本正文」的定向跳转目标:
// 打开文档面板时直接落到对应卷;人物则落到该人物详情。无 target(顶栏文档键)→ 目录。
export type DocTarget =
  | { view: 'world' | 'beats' | 'script' }
  | { view: 'charDetail'; characterId: string };

type Props = {
  open: boolean;
  onClose: () => void;
  screenplay: Screenplay;
  theme?: Theme;
  // 打开时的定向跳转目标(对齐原型 onOpenWorld / onOpenCard / onOpenBeats / onOpenScript)。
  target?: DocTarget | null;
  onFocusCharacter?: (character: Character) => void;
  // 点人物标签 chip:聚焦该属性(#12 聚焦标签)。
  onFocusAttr?: (character: Character, attr: CharacterAttr) => void;
};

// 一行台本拆成:动作行 / 角色提示(可带括注)。对齐原型 parseScript。
type Block = { isCue: boolean; cue?: string; paren?: string; hasParen?: boolean; text: string };
function parseScript(content: string): Block[] {
  const out: Block[] = [];
  String(content || '')
    .split('\n')
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const m = line.match(/^([^：:。，！？、…\s（(]{1,8})(（[^）]*）|\([^)]*\))?\s*[:：]\s*(.+)$/);
      if (m) out.push({ isCue: true, cue: m[1] ?? '', hasParen: !!m[2], paren: (m[2] || '').replace(/^[（(]|[）)]$/g, ''), text: m[3] ?? '' });
      else out.push({ isCue: false, text: line });
    });
  return out;
}

export function DocSheet({ open, onClose, screenplay, theme = defaultTheme, target, onFocusAttr }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { accent } = theme;
  const { t, lang } = useI18n();
  const vol = VOL_I18N[lang];
  const doc = DOC_I18N[lang];

  const [view, setView] = useState<DocView>('contents');
  const [selIdx, setSelIdx] = useState(0);

  // translateY:开 0 / 关 height(滑出屏下)。
  const anim = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: open ? 340 : 280,
      useNativeDriver: true,
    }).start();
  }, [open, anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });

  // 每次打开按 target 定位:footer 带目标 → 跳到对应卷/人物;无目标(顶栏文档键)→ 回目录。
  // 只在「关→开」沿触发,避免流式更新 characters 时重置用户已在文档里的浏览位置。
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      if (!target) setView('contents');
      else if (target.view === 'charDetail') {
        const idx = screenplay.characters.findIndex((c) => c.id === target.characterId);
        setSelIdx(idx >= 0 ? idx : 0);
        setView('charDetail');
      } else setView(target.view);
    }
    wasOpen.current = open;
  }, [open, target, screenplay.characters]);

  const { meta, world, characters, outline, scenes } = screenplay;
  const title = meta.title?.trim() || t('untitled');
  const inVolume = view !== 'contents';
  const selChar = characters[Math.min(selIdx, Math.max(0, characters.length - 1))];

  // 卷标题 / 返回标签。
  const volNum: Record<Exclude<DocView, 'contents' | 'charDetail'>, string> = {
    world: doc.tocNums[0] ?? '',
    chars: doc.tocNums[1] ?? '',
    beats: doc.tocNums[2] ?? '',
    script: doc.tocNums[3] ?? '',
  };
  const volName: Record<Exclude<DocView, 'contents' | 'charDetail'>, string> = {
    world: vol.world,
    chars: vol.chars,
    beats: vol.beats,
    script: vol.script,
  };
  const volTitle =
    view === 'charDetail'
      ? selChar?.name || vol.chars
      : view !== 'contents'
        ? `${volNum[view]} · ${volName[view]}`
        : '';
  const backLabel = view === 'charDetail' ? vol.chars : doc.contents;
  const goBack = () => setView(view === 'charDetail' ? 'chars' : 'contents');

  return (
    <Animated.View
      style={[styles.sheet, { paddingTop: insets.top, transform: [{ translateY }] }]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* 顶栏:eyebrow + 收起 */}
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: palette.placeholder }]}>{t('draftAuto')}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.collapse, { color: palette.textSecondary }]}>{t('collapse')}</Text>
        </Pressable>
      </View>

      {/* 卷内子顶栏:返回 + 卷名 */}
      {inVolume && (
        <View style={styles.subHeader}>
          <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8} style={styles.backBtn}>
            <Text style={[styles.backText, { color: accent }]}>‹ {backLabel}</Text>
          </Pressable>
          <Text style={[styles.volTitle, { color: palette.textPrimary }]} numberOfLines={1}>
            {volTitle}
          </Text>
          <View style={{ width: 44 }} />
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {view === 'contents' && (
          <Contents
            title={title}
            logline={meta.logline?.trim() || ''}
            accent={accent}
            doc={doc}
            vol={vol}
            counts={{ world: world.length, chars: characters.length, beats: outline.length, script: scenes.length }}
            onOpen={setView}
            t={t}
          />
        )}

        {view === 'world' && (
          <View style={styles.volBody}>
            {world.length > 0 ? (
              <View style={{ gap: 10 }}>
                {world.map((w) => (
                  <View key={w.id} style={[styles.facet, { backgroundColor: palette.cardBg, borderColor: palette.borderCard }]}>
                    {!!w.title && (
                      <View style={styles.facetLabelRow}>
                        <View style={[styles.facetDot, { backgroundColor: accent }]} />
                        <ReaderText style={[styles.facetLabel, { color: palette.textPrimary }]}>{w.title}</ReaderText>
                      </View>
                    )}
                    <ReaderText style={[styles.facetBody, { color: palette.textBody }]}>{w.text}</ReaderText>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.empty, { color: palette.placeholder }]}>{t('worldEmpty')}</Text>
            )}
          </View>
        )}

        {view === 'chars' && (
          <View style={styles.volBody}>
            {characters.length > 0 ? (
              characters.map((c, i) => {
                const { identity } = charView(c);
                const badge = badgeBox(identity, accent);
                return (
                  <Pressable
                    key={c.id}
                    style={styles.rosterRow}
                    onPress={() => {
                      setSelIdx(i);
                      setView('charDetail');
                    }}
                    accessibilityRole="button"
                    testID={`doc-char-${c.id}`}
                  >
                    <ReaderText style={[styles.rosterName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</ReaderText>
                    {!!c.role && <ReaderText style={[styles.rosterRole, { color: palette.textSecondary }]}>{c.role}</ReaderText>}
                    <View style={[styles.leader, { borderBottomColor: DOTTED }]} />
                    {!!identity && (
                      <View style={[styles.badge, badge.box]}>
                        <Text style={[styles.badgeText, { color: badge.color }]}>{identity}</Text>
                      </View>
                    )}
                    <Text style={[styles.chevron, { color: palette.placeholder }]}>›</Text>
                  </Pressable>
                );
              })
            ) : (
              <Text style={[styles.empty, { color: palette.placeholder }]}>{t('charsEmpty')}</Text>
            )}
          </View>
        )}

        {view === 'charDetail' && selChar && (
          <CharDetail
            key={selChar.id}
            c={selChar}
            accent={accent}
            accentSoft={theme.accentSoft}
            bioLabel={doc.bioLabel}
            t={t}
            onFocusAttr={onFocusAttr}
          />
        )}

        {view === 'beats' && (
          <View style={styles.volBody}>
            {outline.length > 0 ? (
              <View style={{ gap: 12 }}>
                {outline.map((a) => (
                  <View key={a.id} style={[styles.beatCard, { backgroundColor: palette.cardBg, borderColor: palette.borderCard }]}>
                    <ReaderText style={[styles.beatAct, { color: palette.textPrimary }]}>{a.act}</ReaderText>
                    {splitBeat(a.beat).map((para, j) => (
                      <ReaderText key={j} style={[styles.beatText, { color: palette.textBody }, j > 0 && styles.beatTextGap]}>
                        {para}
                      </ReaderText>
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.empty, { color: palette.placeholder }]}>{t('outlineEmpty')}</Text>
            )}
          </View>
        )}

        {view === 'script' && (
          <View style={styles.volBody}>
            {scenes.length > 0 ? (
              <ScriptView scenes={scenes} accent={accent} />
            ) : (
              <Text style={[styles.empty, { color: palette.placeholder }]}>{t('scenesEmpty')}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

// 目录 / 扉页:封面(题名 + 一句话故事)+ 四卷目录 + 导出方框 + 实时提示。
function Contents({
  title,
  logline,
  accent,
  doc,
  vol,
  counts,
  onOpen,
  t,
}: {
  title: string;
  logline: string;
  accent: string;
  doc: (typeof DOC_I18N)['zh'];
  vol: (typeof VOL_I18N)['zh'];
  counts: { world: number; chars: number; beats: number; script: number };
  onOpen: (v: DocView) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const cnt = (n: number, unit: string) => (n > 0 ? (unit ? `${n} ${unit}` : `${n}`) : doc.tocEmpty);
  const entries: { num: string; title: string; n: number; unit: string; view: DocView }[] = [
    { num: doc.tocNums[0] ?? '', title: vol.world, n: counts.world, unit: doc.tocUnits[0] ?? '', view: 'world' },
    { num: doc.tocNums[1] ?? '', title: vol.chars, n: counts.chars, unit: doc.tocUnits[3] ?? '', view: 'chars' },
    { num: doc.tocNums[2] ?? '', title: vol.beats, n: counts.beats, unit: doc.tocUnits[1] ?? '', view: 'beats' },
    { num: doc.tocNums[3] ?? '', title: vol.script, n: counts.script, unit: doc.tocUnits[2] ?? '', view: 'script' },
  ];
  return (
    <View style={styles.contents}>
      <View style={styles.cover}>
        <Text style={[styles.coverEyebrow, { color: palette.placeholder }]}>{doc.cover}</Text>
        <Text style={[styles.coverTitle, { color: palette.textPrimary }]}>《{title}》</Text>
        {logline ? (
          <ReaderText style={[styles.coverLogline, { color: palette.textSecondary }]}>{logline}</ReaderText>
        ) : (
          <Text style={[styles.coverPending, { color: palette.placeholder }]}>{t('loglinePending')}</Text>
        )}
      </View>

      <Text style={[styles.tocLabel, { color: palette.textSecondary }]}>{doc.contents}</Text>
      {entries.map((e) => (
        <Pressable
          key={e.view}
          style={[styles.tocRow, { borderBottomColor: palette.dividerSoft }]}
          onPress={() => onOpen(e.view)}
          accessibilityRole="button"
        >
          <Text style={[styles.tocNum, { color: e.n > 0 ? accent : palette.placeholder }]}>{e.num}</Text>
          <Text style={[styles.tocTitle, { color: e.n > 0 ? palette.textPrimary : palette.textSecondary }]}>{e.title}</Text>
          <View style={[styles.leader, { borderBottomColor: DOTTED }]} />
          <Text style={[styles.tocCount, { color: palette.textSecondary }]}>{cnt(e.n, e.unit)}</Text>
        </Pressable>
      ))}

      <View style={styles.exportRow}>
        <View style={[styles.exportBox, { backgroundColor: palette.cardBg, borderColor: palette.borderControl }]}>
          <Text style={[styles.exportText, { color: palette.textSecondary }]}>{t('copyFountain')}</Text>
        </View>
        <View style={[styles.exportBox, { backgroundColor: palette.cardBg, borderColor: palette.borderControl }]}>
          <Text style={[styles.exportText, { color: palette.textSecondary }]}>{t('exportPdf')}</Text>
        </View>
      </View>
      <View style={[styles.liveNote, { backgroundColor: palette.noteBg }]}>
        <Text style={[styles.liveNoteText, { color: palette.textSecondary }]}>{t('docLiveNote')}</Text>
      </View>
    </View>
  );
}

// 人物详情:暖色头部(徽标 + 衬线名 + 80×100 肖像)+ 小传 + 标签 chip。
function CharDetail({
  c,
  accent,
  accentSoft,
  bioLabel,
  t,
  onFocusAttr,
}: {
  c: Character;
  accent: string;
  accentSoft: string;
  bioLabel: string;
  t: ReturnType<typeof useI18n>['t'];
  onFocusAttr?: (c: Character, a: CharacterAttr) => void;
}) {
  const { identity, ageGender, bio, tags } = charView(c);
  const badge = badgeBox(identity, accent);
  // 点标签 chip → 展开该属性的值(对齐原型 selTag/selActive);再点同一枚收起。
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTag = tags.find((tg) => tg.id === activeId) ?? null;
  return (
    <View style={styles.detailWrap}>
      <View style={[styles.detailCard, { backgroundColor: palette.cardBg, borderColor: palette.borderCard }]}>
        <View style={[styles.detailHeader, { backgroundColor: palette.charHeaderBg, borderBottomColor: palette.charHeaderBorder }]}>
          <View style={styles.detailInfo}>
            {identity ? (
              <View style={styles.badgeWrap}>
                <View style={[styles.badge, badge.box]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{identity}</Text>
                </View>
              </View>
            ) : (
              <Text style={[styles.noIdentity, { color: palette.placeholder }]}>{t('secChars')}</Text>
            )}
            <ReaderText style={[styles.detailName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</ReaderText>
            {!!c.role && <ReaderText style={[styles.detailRole, { color: palette.textSecondary }]}>{c.role}</ReaderText>}
            {!!ageGender && <ReaderText style={[styles.detailAge, { color: palette.textSecondary }]}>{ageGender}</ReaderText>}
          </View>
          <PortraitThumb character={c} variant="detail" />
        </View>
        <View style={styles.detailBody}>
          {!!bio && (
            <>
              <Text style={[styles.bioLabel, { color: palette.textSecondary }]}>{bioLabel}</Text>
              <ReaderText style={[styles.bio, { color: palette.textPrimaryAlt }]}>{bio}</ReaderText>
            </>
          )}
          {tags.length > 0 && (
            <View style={[styles.tags, !!bio && { marginTop: 18 }]}>
              {tags.map((tg) => {
                const on = tg.id === activeId;
                return (
                  <Pressable
                    key={tg.id}
                    onPress={() => setActiveId((prev) => (prev === tg.id ? null : tg.id))}
                    style={[
                      styles.tag,
                      on
                        ? { borderColor: accent, backgroundColor: accentSoft }
                        : { borderColor: palette.borderChip, backgroundColor: palette.cardBg },
                    ]}
                    accessibilityRole="button"
                  >
                    <ReaderText style={[styles.tagText, { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' }]}>
                      {tg.label}
                    </ReaderText>
                  </Pressable>
                );
              })}
            </View>
          )}
          {/* 选中标签 → 展开值面板(对齐原型);面板内「聊聊这条」走聚焦标签流程(#12)。 */}
          {activeTag && (
            <View style={[styles.attrPanel, { backgroundColor: palette.noteBg, borderColor: palette.borderControl }]}>
              <Text style={[styles.attrPanelLabel, { color: accent }]}>{activeTag.label}</Text>
              {activeTag.value.trim() ? (
                <ReaderText style={[styles.attrPanelValue, { color: palette.textPrimaryAlt }]}>{activeTag.value}</ReaderText>
              ) : (
                <Text style={[styles.attrPanelEmpty, { color: palette.placeholder }]}>{t('attrEmpty')}</Text>
              )}
              {onFocusAttr && (
                <Pressable onPress={() => onFocusAttr(c, activeTag)} accessibilityRole="button" style={styles.attrDiscuss} hitSlop={6}>
                  <Text style={[styles.attrDiscussText, { color: accent }]}>{t('discussAttr')}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// 剧本正文:按场排版(场标 + slug + 动作/对白块)。Scene 无幕字段,故不渲染幕标题。
function ScriptView({ scenes, accent }: { scenes: Screenplay['scenes']; accent: string }) {
  return (
    <View style={{ gap: 30, marginTop: 18 }}>
      {scenes.map((s, i) => {
        const blocks = parseScript(s.content);
        return (
          <View key={s.id}>
            <Text style={[styles.sceneMark, { color: accent }]}>{`— ${i + 1} —`}</Text>
            <ReaderText style={[styles.scriptSlug, { color: palette.textSecondary }]}>{s.slug}</ReaderText>
            {blocks.map((b, j) =>
              b.isCue ? (
                <View key={j} style={styles.cueBlock}>
                  <ReaderText style={[styles.cueName, { color: palette.textPrimary }]}>{b.cue}</ReaderText>
                  {b.hasParen && <ReaderText style={[styles.cueParen, { color: palette.textSecondary }]}>（{b.paren}）</ReaderText>}
                  <ReaderText style={[styles.cueText, { color: palette.textPrimaryAlt }]}>{b.text}</ReaderText>
                </View>
              ) : (
                <ReaderText key={j} style={[styles.action, { color: palette.textPrimaryAlt }]}>
                  {b.text}
                </ReaderText>
              ),
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: palette.pageBg,
    ...defaultTheme.shadows.docPanel,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  eyebrow: { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' },
  collapse: { fontSize: 15 },

  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 9,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  backBtn: { minWidth: 44 },
  backText: { fontSize: 13, fontWeight: '600' },
  volTitle: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'center' },

  // —— 目录 ——
  contents: { paddingHorizontal: 30, paddingTop: 28, paddingBottom: 34 },
  cover: { alignItems: 'center', paddingTop: 8, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: palette.borderCard, marginBottom: 22 },
  coverEyebrow: { fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 16 },
  coverTitle: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 30, fontWeight: '700', letterSpacing: 1, marginBottom: 13, textAlign: 'center' },
  coverLogline: { fontSize: 13, lineHeight: 23, textAlign: 'center', paddingHorizontal: 6 },
  coverPending: { fontSize: 12.5 },
  tocLabel: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 13, letterSpacing: 3, marginBottom: 12 },
  tocRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 14, borderBottomWidth: 1 },
  tocNum: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 15, fontWeight: '600', width: 30 },
  tocTitle: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 15 },
  leader: { flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', marginHorizontal: 8, transform: [{ translateY: -3 }] },
  tocCount: { fontSize: 12 },
  exportRow: { flexDirection: 'row', gap: 9, marginTop: 26 },
  exportBox: { flex: 1, alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderRadius: 12 },
  exportText: { fontSize: 12.5 },
  liveNote: { marginTop: 14, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12 },
  liveNoteText: { fontSize: 12, lineHeight: 19 },

  // —— 卷通用 ——
  volBody: { paddingHorizontal: 30, paddingTop: 22, paddingBottom: 16 },
  empty: { fontSize: 13 },

  // 世界设定
  facet: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 13 },
  facetLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  facetDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 8 },
  facetLabel: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 13.5, fontWeight: '600' },
  facetBody: { fontSize: 13, lineHeight: 23 },

  // 人物表 roster
  rosterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: palette.dividerSoft },
  rosterName: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 16 },
  rosterRole: { fontSize: 12, marginLeft: 9 },
  chevron: { fontSize: 15, marginLeft: 10 },

  // 徽标(roster + detail 共用)
  badge: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11.5, fontWeight: '600' },
  badgeWrap: { flexDirection: 'row', marginBottom: 8 },
  noIdentity: { fontSize: 11, letterSpacing: 1.5, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },

  // 人物详情
  detailWrap: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 16 },
  detailCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 15, borderBottomWidth: 1 },
  detailInfo: { flex: 1, minWidth: 0 },
  detailName: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 22, fontWeight: '700', lineHeight: 26 },
  detailRole: { fontSize: 12.5, marginTop: 2 },
  detailAge: { fontSize: 12.5, marginTop: 10 },
  detailBody: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 },
  bioLabel: { fontSize: 13, fontWeight: '600', marginBottom: 5 },
  bio: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14.5, lineHeight: 26 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  tagText: { fontSize: 12.5, fontWeight: '500' },
  // 选中标签的值面板(对齐原型 selActive)
  attrPanel: { marginTop: 14, borderWidth: 1, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13 },
  attrPanelLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  attrPanelValue: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14, lineHeight: 25 },
  attrPanelEmpty: { fontSize: 13 },
  attrDiscuss: { marginTop: 10, alignSelf: 'flex-start' },
  attrDiscussText: { fontSize: 12.5, fontWeight: '600' },

  // 故事节拍
  beatCard: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 14 },
  beatAct: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  beatText: { fontSize: 13, lineHeight: 23 },
  beatTextGap: { marginTop: 9 },

  // 剧本正文
  sceneMark: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 12, fontWeight: '600', letterSpacing: 3, textAlign: 'center', marginBottom: 12 },
  scriptSlug: { fontFamily: MONO, fontSize: 11.5, letterSpacing: 1, fontWeight: '600', marginBottom: 14 },
  action: { fontSize: 13, lineHeight: 24, marginBottom: 12 },
  cueBlock: { marginBottom: 12 },
  cueName: { fontSize: 12, letterSpacing: 2, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  cueParen: { fontSize: 11, textAlign: 'center', marginBottom: 4 },
  cueText: { fontSize: 13, lineHeight: 23, textAlign: 'center', paddingHorizontal: 30 },
});
