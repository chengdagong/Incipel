// 内联卡片:助手每轮产出新内容时,消息下方内联一张卡片,只显示本轮新增。
// 本轮新增 = 本轮产生的那批 STATE_DELTA(system-design §6.2);此处接收已解析为实体切片的数据。
// 分区:世界观 / 人物 / 大纲 / 分场对白。

import { StyleSheet, Text, View } from 'react-native';
import type { Act, Character, Scene, WorldSection } from '@incipel/shared';
import { defaultTheme, type Theme } from '../theme';

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
};

export function InlineCard({ data, theme = defaultTheme, onOpenDoc }: Props) {
  const { palette } = theme;
  const hasAny =
    !!data.world?.length ||
    !!data.characters?.length ||
    !!data.outline?.length ||
    !!data.scenes?.length;

  if (!hasAny) return null;

  return (
    <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.border }]}>
      {data.world?.map((w) => (
        <Section key={w.id} label="世界观" title={w.title} body={w.text} theme={theme} />
      ))}
      {data.characters?.map((c) => (
        <Section key={c.id} label="人物" title={c.name} body={c.note} theme={theme} />
      ))}
      {data.outline?.map((a) => (
        <Section key={a.id} label="大纲" title={a.act} body={a.beat} theme={theme} />
      ))}
      {data.scenes?.map((s) => (
        <Section key={s.id} label="分场 · 对白" title={s.slug} body={s.content} theme={theme} />
      ))}

      <Text
        style={[styles.openDoc, { color: theme.accent }]}
        onPress={onOpenDoc}
        accessibilityRole="button"
      >
        打开文档 →
      </Text>
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

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, gap: 10 },
  section: { gap: 2 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  title: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20 },
  openDoc: { fontSize: 13, fontWeight: '600', marginTop: 2 },
});
