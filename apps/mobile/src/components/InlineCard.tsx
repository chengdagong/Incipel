// 内联卡片:助手每轮产出新内容时,消息下方内联一张卡片,只显示本轮新增。
// 本轮新增 = 本轮产生的那批 STATE_DELTA(system-design §6.2);此处接收已解析为实体切片的数据。
// 分区:世界观 / 人物 / 大纲 / 分场对白。

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Act, Character, CharacterAttr, Scene, WorldSection } from '@incipel/shared';
import { defaultTheme, type Theme } from '../theme';
import { useT } from '../i18n';
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
  // 点底部按钮打开文档全文(system-design §2.1)。
  onOpenDoc?: () => void;
  // 聚焦标签(#12):点人物属性 / 整个人物。
  onFocusAttr?: (c: Character, a: CharacterAttr) => void;
  onFocusCharacter?: (c: Character) => void;
};

export function InlineCard({ data, theme = defaultTheme, onOpenDoc, onFocusAttr, onFocusCharacter }: Props) {
  const { palette } = theme;
  const t = useT();
  const hasAny =
    !!data.world?.length ||
    !!data.characters?.length ||
    !!data.outline?.length ||
    !!data.scenes?.length;

  if (!hasAny) return null;

  return (
    <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.border }]}>
      {data.world?.map((w) => (
        <Section key={w.id} label={t('secWorld')} title={w.title} body={w.text} theme={theme} />
      ))}
      {data.characters?.map((c) => (
        <CharacterBlock
          key={c.id}
          c={c}
          theme={theme}
          onFocusAttr={onFocusAttr}
          onFocusCharacter={onFocusCharacter}
        />
      ))}
      {data.outline?.map((a) => (
        <Section key={a.id} label={t('secOutline')} title={a.act} body={a.beat} theme={theme} />
      ))}
      {data.scenes?.map((s) => (
        <Section key={s.id} label={t('secScenes')} title={s.slug} body={s.content} theme={theme} />
      ))}

      <Pressable style={styles.footer} onPress={onOpenDoc} accessibilityRole="button">
        <View style={styles.footerLeft}>
          <View style={[styles.footerDot, { backgroundColor: theme.accent }]} />
          <Text style={styles.footerSaved}>{t('savedToDraft')}</Text>
        </View>
        <Text style={[styles.footerOpen, { color: theme.accent }]}>{t('openFullDoc')}</Text>
      </Pressable>
    </View>
  );
}

function Section({
  label,
  title,
  body,
  theme,
}: {
  label: string;
  title: string;
  body: string;
  theme: Theme;
}) {
  const { palette } = theme;
  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme.accent }]}>{label}</Text>
      {!!title && <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>}
      {!!body && <Text style={[styles.body, { color: palette.textPrimaryAlt }]}>{body}</Text>}
    </View>
  );
}

// 人物分区:名字 + 一句话定位 + 可点属性行(点属性/「聊聊 TA」生成聚焦标签,见 #12)。
function CharacterBlock({
  c,
  theme,
  onFocusAttr,
  onFocusCharacter,
}: {
  c: Character;
  theme: Theme;
  onFocusAttr?: (c: Character, a: CharacterAttr) => void;
  onFocusCharacter?: (c: Character) => void;
}) {
  const { palette } = theme;
  const t = useT();
  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme.accent }]}>{t('secChars')}</Text>
      <View style={styles.charRow}>
        <PortraitThumb character={c} />
        <View style={styles.charInfo}>
          <Text style={[styles.charName, { color: palette.textPrimary }]}>{c.name || t('unnamedChar')}</Text>
          {!!c.role && <Text style={[styles.charRole, { color: palette.textSecondary }]}>{c.role}</Text>}
          {c.attrs.length > 0 && (
            <View style={styles.attrList}>
              {c.attrs.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={onFocusAttr ? () => onFocusAttr(c, a) : undefined}
                  style={({ pressed }) => [styles.attrRow, pressed && styles.attrRowPressed]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.attrLabel, { color: palette.textSecondary }]}>{a.label}</Text>
                  <Text style={[styles.attrValue, { color: palette.textPrimaryAlt }]}>{a.value}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {!!onFocusCharacter && (
            <Pressable
              onPress={() => onFocusCharacter(c)}
              hitSlop={6}
              accessibilityRole="button"
              // E2E:同屏多个人物时「聊聊 TA」文案相同,按人物 id 区分。
              testID={`char-chat-${c.id}`}
            >
              <Text style={[styles.charAction, { color: theme.accent }]}>{t('chatAboutChar')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, gap: 10 },
  section: { gap: 2 },
  charRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  charInfo: { flex: 1, gap: 2 },
  charName: { fontSize: 15, fontWeight: '600' },
  charRole: { fontSize: 12, marginTop: 1 },
  attrList: { marginTop: 6 },
  attrRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  attrRowPressed: { backgroundColor: '#F4EFE7' },
  attrLabel: { width: 42, fontSize: 13, lineHeight: 21 },
  attrValue: { flex: 1, fontSize: 13, lineHeight: 21 },
  charAction: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  title: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F2EFE9',
    paddingTop: 11,
    marginTop: 2,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerDot: { width: 5, height: 5, borderRadius: 3 },
  footerSaved: { fontSize: 11.5, color: '#8B867C' },
  footerOpen: { fontSize: 12, fontWeight: '600' },
});
