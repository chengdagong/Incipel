// 内联卡片:助手每轮产出新内容时,消息下方内联卡片,只显示本轮新增(本轮 STATE_DELTA,system-design §6.2)。
// 视觉对齐最新 handoff 原型:人物为带暖色头部的独立卡片(身份徽标 + 衬线名 + 76×96 肖像 + 小传 + 标签 chip),
// 世界观 / 大纲 / 分场各为带「打开…」页脚的卡片。点标签 chip 生成聚焦标签(#12);点页脚打开文档。

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Act, Character, CharacterAttr, Scene, WorldSection } from '@incipel/shared';
import { defaultTheme, palette, type Theme } from '../theme';
import { useI18n, VOL_I18N } from '../i18n';
import { badgeBox, charView } from '../charView';
import { PortraitThumb } from './PortraitThumb';

// 本轮卡片只承载「新增/改动的实体切片」,各区可空。
export type InlineCardData = {
  world?: WorldSection[];
  characters?: Character[];
  outline?: Act[];
  scenes?: Scene[];
};

type Props = {
  data: InlineCardData;
  theme?: Theme;
  // 点页脚打开文档全文(system-design §2.1)。
  onOpenDoc?: () => void;
  // 聚焦标签(#12):点人物标签 chip。
  onFocusAttr?: (c: Character, a: CharacterAttr) => void;
  // 兼容旧签名(整人物聚焦)——本设计页脚改为「打开人物卡片」,不再单列「聊聊 TA」。
  onFocusCharacter?: (c: Character) => void;
};

export function InlineCard({ data, theme = defaultTheme, onOpenDoc, onFocusAttr }: Props) {
  const { lang } = useI18n();
  const vol = VOL_I18N[lang];
  const openLabel = (x: string) => vol.openTmpl.replace('{x}', x);
  const hasAny =
    !!data.world?.length || !!data.characters?.length || !!data.outline?.length || !!data.scenes?.length;
  if (!hasAny) return null;

  return (
    <View style={styles.wrap}>
      {!!data.world?.length && (
        <SectionCard label="secWorld" footer={openLabel(vol.world)} onOpen={onOpenDoc} theme={theme}>
          {data.world.map((w) => (
            <Text key={w.id} style={[styles.bodyPara, { color: palette.textBody }]}>
              {w.title ? `${w.title} — ${w.text}` : w.text}
            </Text>
          ))}
        </SectionCard>
      )}

      {data.characters?.map((c) => (
        <CharacterCard key={c.id} c={c} theme={theme} onOpen={onOpenDoc} onFocusAttr={onFocusAttr} footer={vol.charCard} />
      ))}

      {!!data.outline?.length && (
        <SectionCard label="secOutline" footer={openLabel(vol.beats)} onOpen={onOpenDoc} theme={theme}>
          {data.outline.map((a) => (
            <Text key={a.id} style={[styles.outlineItem, { color: palette.textSecondary }]}>
              <Text style={{ color: palette.textPrimary, fontWeight: '700' }}>{a.act}</Text>
              {a.beat ? ` · ${a.beat}` : ''}
            </Text>
          ))}
        </SectionCard>
      )}

      {!!data.scenes?.length && (
        <SectionCard label="secScenes" footer={openLabel(vol.script)} onOpen={onOpenDoc} theme={theme}>
          {data.scenes.map((s) => (
            <View key={s.id} style={styles.scene}>
              <Text style={[styles.sceneSlug, { color: palette.textSecondary }]}>{s.slug}</Text>
              <Text style={[styles.sceneContent, { color: palette.textBody }]}>{s.content}</Text>
            </View>
          ))}
        </SectionCard>
      )}
    </View>
  );
}

// 通用区卡片:暖色描边卡 + 顶部主色小标题(后接一条横线)+ 内容 + 「打开…」页脚。
function SectionCard({
  label,
  footer,
  onOpen,
  theme,
  children,
}: {
  label: 'secWorld' | 'secOutline' | 'secScenes';
  footer: string;
  onOpen?: () => void;
  theme: Theme;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.card}>
      <View style={styles.secBlock}>
        <View style={styles.secLabelRow}>
          <Text style={[styles.secLabel, { color: theme.accent }]}>{t(label)}</Text>
          <View style={[styles.secLine, { backgroundColor: palette.divider }]} />
        </View>
        {children}
      </View>
      <Footer label={footer} onPress={onOpen} accent={theme.accent} />
    </View>
  );
}

// 人物卡:暖色头部(身份徽标 + 衬线名 + 角色 + 年龄性别 + 76×96 肖像)+ 小传 + 标签 chip + 页脚。
function CharacterCard({
  c,
  theme,
  onOpen,
  onFocusAttr,
  footer,
}: {
  c: Character;
  theme: Theme;
  onOpen?: () => void;
  onFocusAttr?: (c: Character, a: CharacterAttr) => void;
  footer: string;
}) {
  const { t } = useI18n();
  const { identity, ageGender, bio, tags } = charView(c);
  const badge = badgeBox(identity, theme.accent);

  return (
    <View style={styles.card}>
      <View style={[styles.charHeader, { backgroundColor: palette.charHeaderBg, borderBottomColor: palette.charHeaderBorder }]}>
        <View style={styles.charInfo}>
          {identity ? (
            <View style={styles.badgeWrap}>
              <View style={[styles.badge, badge.box]}>
                <Text style={[styles.badgeText, { color: badge.color }]}>{identity}</Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.noIdentity, { color: palette.placeholder }]}>{t('secChars')}</Text>
          )}
          <Text style={[styles.charName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</Text>
          {!!c.role && <Text style={[styles.charRole, { color: palette.textSecondary }]}>{c.role}</Text>}
          {!!ageGender && <Text style={[styles.charAge, { color: palette.textSecondary }]}>{ageGender}</Text>}
        </View>
        <PortraitThumb character={c} variant="card" />
      </View>

      <View style={styles.charBody}>
        {!!bio && <Text style={[styles.bio, { color: palette.textPrimaryAlt }]}>{bio}</Text>}
        {tags.length > 0 && (
          <View style={[styles.tags, !!bio && { marginTop: 12 }]}>
            {tags.map((tg) => (
              <Pressable
                key={tg.id}
                onPress={onFocusAttr ? () => onFocusAttr(c, tg) : undefined}
                style={[styles.tag, { borderColor: palette.borderChip, backgroundColor: palette.cardBg }]}
                accessibilityRole="button"
              >
                <Text style={[styles.tagText, { color: palette.textSecondary }]}>{tg.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Footer label={footer} onPress={onOpen} accent={theme.accent} />
    </View>
  );
}

function Footer({ label, onPress, accent }: { label: string; onPress?: () => void; accent: string }) {
  return (
    <Pressable
      style={[styles.footer, { backgroundColor: palette.sectionFooterBg, borderTopColor: palette.dividerSoft }]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.footerLabel, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 13, gap: 16 },
  card: { backgroundColor: palette.cardAlt, borderWidth: 1, borderColor: palette.borderAlt, borderRadius: 14, overflow: 'hidden' },

  // 区块(世界观 / 大纲 / 分场)
  secBlock: { paddingHorizontal: 15, paddingVertical: 14 },
  secLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  secLabel: { fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  secLine: { flex: 1, height: 1, marginLeft: 7 },
  bodyPara: { fontSize: 13, lineHeight: 23, marginBottom: 8 },
  outlineItem: { fontSize: 12.5, lineHeight: 20, marginBottom: 9 },
  scene: { marginBottom: 14 },
  sceneSlug: { fontFamily: defaultTheme.fonts.mono, fontSize: 11, letterSpacing: 1, marginBottom: 7 },
  sceneContent: { fontFamily: defaultTheme.fonts.mono, fontSize: 12.5, lineHeight: 22 },

  // 人物卡
  charHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 13, borderBottomWidth: 1 },
  charInfo: { flex: 1, minWidth: 0 },
  badgeWrap: { flexDirection: 'row', marginBottom: 7 },
  badge: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11.5, fontWeight: '600' },
  noIdentity: { fontSize: 10.5, letterSpacing: 1.5, fontWeight: '600', textTransform: 'uppercase', marginBottom: 5 },
  charName: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 20, fontWeight: '700', lineHeight: 24 },
  charRole: { fontSize: 12, marginTop: 2 },
  charAge: { fontSize: 12, marginTop: 9 },
  charBody: { paddingHorizontal: 15, paddingTop: 14, paddingBottom: 15 },
  bio: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14, lineHeight: 25 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  tagText: { fontSize: 12, fontWeight: '500' },

  // 页脚「打开…」
  footer: { paddingHorizontal: 15, paddingVertical: 11, borderTopWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footerLabel: { fontSize: 12, fontWeight: '600' },
});
