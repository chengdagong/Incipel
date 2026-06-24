// 设置 ›开发:Expo Go / development build 里可改 Agent 地址(release build 不可见,直接重定向回索引)。
// 输入解析 / 保存 / 恢复默认逻辑由旧单页设置迁出,行为不变。

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useI18n } from '../../../src/i18n';
import { defaultTheme, palette } from '../../../src/theme';
import { useAgentEndpointSettings } from '../../../src/agentEndpoint';
import { SettingsGroup, SettingsScreen } from '../../../src/components/SettingsScaffold';

export default function DeveloperSettingsScreen() {
  const { t } = useI18n();
  const { accent } = defaultTheme;
  const agentEndpoint = useAgentEndpointSettings();

  const [agentInput, setAgentInput] = useState('');
  const [agentPendingAction, setAgentPendingAction] = useState<'save' | 'reset' | null>(null);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const agentBusy = agentPendingAction !== null;

  useEffect(() => {
    if (!agentEndpoint.visible || !agentEndpoint.ready) return;
    setAgentInput(agentEndpoint.overrideBaseUrl ?? agentEndpoint.effectiveBaseUrl);
  }, [agentEndpoint.visible, agentEndpoint.ready, agentEndpoint.overrideBaseUrl, agentEndpoint.effectiveBaseUrl]);

  async function saveAgentEndpoint() {
    if (agentBusy || !agentEndpoint.ready) return;
    setAgentPendingAction('save');
    setAgentError(null);
    setAgentMessage(null);
    try {
      const parsed = await agentEndpoint.saveOverride(agentInput);
      if (!parsed.ok) {
        setAgentError(t('agentEndpointInvalid'));
        return;
      }
      setAgentInput(parsed.value);
      setAgentMessage(t('agentEndpointSaved'));
    } catch (e) {
      console.warn('[settings/developer] 保存 Agent 地址失败:', e);
      setAgentError(t('agentEndpointSaveFailed'));
    } finally {
      setAgentPendingAction(null);
    }
  }

  async function resetAgentEndpoint() {
    if (agentBusy || !agentEndpoint.ready) return;
    setAgentPendingAction('reset');
    setAgentError(null);
    setAgentMessage(null);
    try {
      await agentEndpoint.clearOverride();
      setAgentInput(agentEndpoint.defaultBaseUrl);
      setAgentMessage(t('agentEndpointResetDone'));
    } catch (e) {
      console.warn('[settings/developer] 恢复 Agent 默认地址失败:', e);
      setAgentError(t('agentEndpointSaveFailed'));
    } finally {
      setAgentPendingAction(null);
    }
  }

  // release build 不暴露此页:直接回索引,避免深链进到一个空壳。
  if (!agentEndpoint.visible) return <Redirect href="/settings" />;

  return (
    <SettingsScreen title={t('agentEndpointSection')} testID="settings-developer">
      <SettingsGroup>
        <View style={styles.body}>
          <Text style={styles.label}>{t('agentEndpointLabel')}</Text>
          <TextInput
            value={agentInput}
            onChangeText={(text) => {
              setAgentInput(text);
              setAgentError(null);
              setAgentMessage(null);
            }}
            editable={agentEndpoint.ready && !agentBusy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={t('agentEndpointPlaceholder')}
            placeholderTextColor={palette.placeholder}
            style={styles.input}
            testID="settings-agent-endpoint-input"
          />
          <View style={styles.actions}>
            <Pressable
              onPress={saveAgentEndpoint}
              disabled={!agentEndpoint.ready || agentBusy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? defaultTheme.accentHover : accent },
                (!agentEndpoint.ready || agentBusy) && styles.buttonDisabled,
              ]}
              testID="settings-agent-endpoint-save"
            >
              {agentPendingAction === 'save' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('agentEndpointSave')}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={resetAgentEndpoint}
              disabled={!agentEndpoint.ready || agentBusy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryPressed,
                (!agentEndpoint.ready || agentBusy) && styles.buttonDisabled,
              ]}
              testID="settings-agent-endpoint-reset"
            >
              {agentPendingAction === 'reset' ? (
                <ActivityIndicator color={palette.textSecondary} />
              ) : (
                <Text style={styles.secondaryText}>{t('agentEndpointReset')}</Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.current}>
            {t('agentEndpointCurrent')}: {agentEndpoint.effectiveBaseUrl || t('agentEndpointDefault')}
          </Text>
          {agentError ? <Text style={styles.error}>{agentError}</Text> : null}
          {agentMessage ? <Text style={styles.message}>{agentMessage}</Text> : null}
        </View>
      </SettingsGroup>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingVertical: 14, paddingHorizontal: 16, gap: 10, backgroundColor: palette.cardBg },
  label: { fontSize: 15, color: palette.textPrimary },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.textPrimary,
    backgroundColor: palette.cardBg,
    fontSize: 14,
  },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  button: { minHeight: 40, minWidth: 86, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondaryButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.borderControl,
    backgroundColor: palette.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryPressed: { backgroundColor: palette.pressedBg },
  secondaryText: { color: palette.textSecondary, fontSize: 14, fontWeight: '600' },
  current: { color: palette.textSecondary, fontSize: 12.5, lineHeight: 18 },
  error: { color: palette.danger, fontSize: 12.5, lineHeight: 18 },
  message: { color: palette.textSecondary, fontSize: 12.5, lineHeight: 18 },
});
