// 设置 ›阅读:剧本内容字号 / 行距 / 段距分档 + 预览。仅作用于文档与内联卡片(不改界面其它文字)。
// 分档逻辑与预览由旧单页设置迁出,行为不变。

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { READING_I18N, useI18n } from '../../../src/i18n';
import { defaultTheme, palette } from '../../../src/theme';
import { useReadingPrefs } from '../../../src/readingPrefs';
import { ReaderText } from '../../../src/components/ReaderText';
import { scaleGap, scaleTitleBodyGap, type FontLevel, type LineLevel, type ParaLevel } from '../../../src/readingScale';
import { SettingsGroup, SettingsScreen } from '../../../src/components/SettingsScaffold';

export default function ReadingSettingsScreen() {
  const { lang } = useI18n();
  const { accent, accentSoft, accentSoftBorder } = defaultTheme;
  const reading = READING_I18N[lang];
  const { fontLevel, lineLevel, paraLevel, setFontLevel, setLineLevel, setParaLevel, paraScale } = useReadingPrefs();

  const fontOptions: { value: FontLevel; label: string }[] = [
    { value: 'small', label: reading.fontSmall },
    { value: 'standard', label: reading.fontStandard },
    { value: 'large', label: reading.fontLarge },
    { value: 'xlarge', label: reading.fontXLarge },
  ];
  const lineOptions: { value: LineLevel; label: string }[] = [
    { value: 'compact', label: reading.lineCompact },
    { value: 'standard', label: reading.lineStandard },
    { value: 'loose', label: reading.lineLoose },
  ];
  const paraOptions: { value: ParaLevel; label: string }[] = [
    { value: 'compact', label: reading.lineCompact },
    { value: 'standard', label: reading.lineStandard },
    { value: 'loose', label: reading.lineLoose },
  ];

  return (
    <SettingsScreen title={reading.section} testID="settings-reading">
      <SettingsGroup footer={reading.desc}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{reading.fontSize}</Text>
          <Segmented
            options={fontOptions}
            value={fontLevel}
            onChange={setFontLevel}
            accent={accent}
            accentSoft={accentSoft}
            accentSoftBorder={accentSoftBorder}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{reading.lineSpacing}</Text>
          <Segmented
            options={lineOptions}
            value={lineLevel}
            onChange={setLineLevel}
            accent={accent}
            accentSoft={accentSoft}
            accentSoftBorder={accentSoftBorder}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{reading.paraSpacing}</Text>
          <Segmented
            options={paraOptions}
            value={paraLevel}
            onChange={setParaLevel}
            accent={accent}
            accentSoft={accentSoft}
            accentSoftBorder={accentSoftBorder}
          />
        </View>
      </SettingsGroup>

      <View style={styles.previewCard}>
        <Text style={[styles.previewEyebrow, { color: accent }]}>{reading.previewLabel}</Text>
        <ReaderText style={[styles.previewAct, { color: palette.textPrimary }, { marginBottom: scaleTitleBodyGap('readingPreview', paraScale) }]}>
          {reading.sampleAct}
        </ReaderText>
        <ReaderText style={[styles.previewBeat, { color: palette.textBody }]}>{reading.sampleBeat}</ReaderText>
        <ReaderText style={[styles.previewBeat, { color: palette.textBody }, { marginTop: scaleGap(9, paraScale) }]}>
          {reading.sampleBeat2}
        </ReaderText>
      </View>
    </SettingsScreen>
  );
}

// 分档按钮:一排等宽药丸,选中=暖色浅底 + 主色字(沿用语言项的选中观感)。
function Segmented<T extends string>({
  options,
  value,
  onChange,
  accent,
  accentSoft,
  accentSoftBorder,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent: string;
  accentSoft: string;
  accentSoftBorder: string;
}) {
  return (
    <View style={styles.segRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              styles.segPill,
              on
                ? { backgroundColor: accentSoft, borderColor: accentSoftBorder }
                : { backgroundColor: palette.cardBg, borderColor: palette.borderChip },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`reading-seg-${o.value}`}
          >
            <Text style={[styles.segText, { color: on ? accent : palette.textSecondary, fontWeight: on ? '600' : '500' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 14, paddingHorizontal: 16, backgroundColor: palette.cardBg },
  rowLabel: { fontSize: 15, color: palette.textPrimary, marginBottom: 10 },
  segRow: { flexDirection: 'row', gap: 6 },
  segPill: { flex: 1, paddingVertical: 8, borderWidth: 1, borderRadius: 10, alignItems: 'center' },
  segText: { fontSize: 13 },

  previewCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: palette.borderAlt,
    borderRadius: 14,
    backgroundColor: palette.cardAlt,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  previewEyebrow: { fontSize: 11, letterSpacing: 1, fontWeight: '600', marginBottom: 9 },
  previewAct: { fontFamily: defaultTheme.fonts.serifTitle, fontSize: 14.5, fontWeight: '600', lineHeight: 22 },
  previewBeat: { fontSize: 13, lineHeight: 23 },
});
