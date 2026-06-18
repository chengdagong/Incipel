// 文档面板:累积的剧本全文,随对话实时更新。
// 人物卡可点击回到对话修订(带 character.id,触发一次聚焦该角色的 run,见 system-design §10)。
// 阶段(stage)用 @incipel/shared 的 deriveStage / STAGE_LABELS 显示。

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  type Character,
  type Screenplay,
  STAGE_LABELS,
  deriveStage,
} from '@incipel/shared';
import { defaultTheme, type Theme } from '../theme';

type Props = {
  screenplay: Screenplay;
  theme?: Theme;
  // 点人物卡「聊聊 TA」:回到对话修订该角色。
  onFocusCharacter?: (character: Character) => void;
};

export function DocPanel({ screenplay, theme = defaultTheme, onFocusCharacter }: Props) {
  const { palette } = theme;
  const stage = deriveStage(screenplay);

  return (
    <ScrollView
      style={[styles.panel, { backgroundColor: palette.cardBg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: palette.textPrimary }]}>
        {screenplay.meta.title || '未命名作品'}
      </Text>
      {!!screenplay.meta.logline && (
        <Text style={[styles.logline, { color: palette.textSecondary }]}>
          {screenplay.meta.logline}
        </Text>
      )}
      <Text style={[styles.stage, { color: theme.accent }]}>当前阶段:{STAGE_LABELS[stage]}</Text>

      <Block label="世界观" theme={theme}>
        {screenplay.world.map((w) => (
          <Entry key={w.id} title={w.title} body={w.text} theme={theme} />
        ))}
      </Block>

      <Block label="人物" theme={theme}>
        {screenplay.characters.map((c) => (
          <Entry
            key={c.id}
            title={c.name}
            body={c.note}
            theme={theme}
            // 人物卡可点回对话修订。
            onPress={onFocusCharacter ? () => onFocusCharacter(c) : undefined}
            actionLabel="聊聊 TA"
          />
        ))}
      </Block>

      <Block label="大纲" theme={theme}>
        {screenplay.outline.map((a) => (
          <Entry key={a.id} title={a.act} body={a.beat} theme={theme} />
        ))}
      </Block>

      <Block label="分场 · 对白" theme={theme}>
        {screenplay.scenes.map((s) => (
          <Entry key={s.id} title={s.slug} body={s.content} theme={theme} />
        ))}
      </Block>
    </ScrollView>
  );
}

function Block({
  label,
  theme,
  children,
}: {
  label: string;
  theme: Theme;
  children: React.ReactNode;
}) {
  const empty = !children || (Array.isArray(children) && children.flat().length === 0);
  return (
    <View style={styles.block}>
      <Text style={[styles.blockLabel, { color: theme.palette.textSecondary }]}>{label}</Text>
      {empty ? (
        <Text style={[styles.emptyHint, { color: theme.palette.textSecondaryAlt }]}>(待补充)</Text>
      ) : (
        children
      )}
    </View>
  );
}

function Entry({
  title,
  body,
  theme,
  onPress,
  actionLabel,
}: {
  title: string;
  body: string;
  theme: Theme;
  onPress?: () => void;
  actionLabel?: string;
}) {
  const { palette } = theme;
  return (
    <View style={[styles.entry, { borderColor: palette.borderAlt }]}>
      {!!title && <Text style={[styles.entryTitle, { color: palette.textPrimary }]}>{title}</Text>}
      {!!body && <Text style={[styles.entryBody, { color: palette.textPrimaryAlt }]}>{body}</Text>}
      {!!onPress && (
        <Text
          style={[styles.action, { color: theme.accent }]}
          onPress={onPress}
          accessibilityRole="button"
        >
          {actionLabel ?? '修订'} →
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', fontFamily: defaultTheme.fonts.serifTitle },
  logline: { fontSize: 14, lineHeight: 20 },
  stage: { fontSize: 12, fontWeight: '600' },
  block: { gap: 8 },
  blockLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  emptyHint: { fontSize: 13, fontStyle: 'italic' },
  entry: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  entryTitle: { fontSize: 15, fontWeight: '600' },
  entryBody: { fontSize: 14, lineHeight: 20 },
  action: { fontSize: 13, fontWeight: '600', marginTop: 2 },
});
