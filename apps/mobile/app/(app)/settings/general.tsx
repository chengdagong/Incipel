// 设置 ›通用:界面语言。独立成屏后用整列语言行 + 勾选(替代旧单页里的下拉),选中即切换。
// 多语言只切界面文案,不影响 AI 回复语言(见 i18n.tsx / langDesc)。

import { StyleSheet, Text } from 'react-native';
import { LANGS, useI18n } from '../../../src/i18n';
import { defaultTheme } from '../../../src/theme';
import { SettingsGroup, SettingsRow, SettingsScreen } from '../../../src/components/SettingsScaffold';

export default function GeneralSettingsScreen() {
  const { t, lang, setLang } = useI18n();
  const { accent } = defaultTheme;

  return (
    <SettingsScreen title={t('generalSection')} testID="settings-general">
      <SettingsGroup title={t('langLabel')} footer={t('langDesc')}>
        {LANGS.map((l) => (
          <SettingsRow
            key={l.code}
            label={l.name}
            onPress={() => setLang(l.code)}
            right={l.code === lang ? <Text style={[styles.check, { color: accent }]}>✓</Text> : null}
            testID={`settings-lang-${l.code}`}
          />
        ))}
      </SettingsGroup>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  check: { fontSize: 15, fontWeight: '700' },
});
