// 历史会话:全屏会话列表;续写、删除;空状态引导(system-design §2.1「历史会话」/ §10)。
// 视觉对齐最新 handoff 原型「HISTORY SCREEN」:自带顶栏(返回 + 标题 + 新建)、卡片 + ✕ 删除、空态。
// 列表直接用 supabase-js 查 sessions(RLS 按 user_id 隔离,见 §8)。

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Screenplay } from '@incipel/shared';
import { timeAgo } from '../../src/components/Drawer';
import { useT } from '../../src/i18n';
import { sessionTitleForDisplay } from '../../src/session-title';
import { supabase } from '../../src/supabase';
import { defaultTheme, palette } from '../../src/theme';

const { accent } = defaultTheme;

// sessions 行的子集(见 system-design §8 数据模型)。
type SessionRow = {
  id: string;
  title: string | null;
  accent: string | null;
  starred: boolean;
  updated_at: string;
  documents: { state: Screenplay } | null;
};

export default function HistoryScreen() {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, accent, starred, updated_at, documents(state)')
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('[history] 查询失败:', error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as SessionRow[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => {
    load();
  }, [load]);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }
  function startNew() {
    router.replace('/');
  }
  function resume(id: string) {
    router.push({ pathname: '/chat', params: { sessionId: id } });
  }

  async function remove(id: string) {
    const { error } = await supabase.from('sessions').delete().eq('id', id);
    if (error) {
      console.warn('[history] 删除失败:', error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  // 删除不可恢复:先二次确认。react-native-web 的 Alert 是空实现,Web 走浏览器 confirm。
  function confirmRemove(id: string) {
    if (Platform.OS === 'web') {
      const g = globalThis as unknown as { confirm?: (message: string) => boolean };
      const ok = typeof g.confirm === 'function' ? g.confirm(`${t('deleteConfirm')}\n\n${t('deleteConfirmSub')}`) : false;
      if (ok) void remove(id);
      return;
    }
    Alert.alert(t('deleteConfirm'), t('deleteConfirmSub'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('deleteWork'), style: 'destructive', onPress: () => void remove(id) },
    ]);
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg, paddingTop: insets.top }]}>
      {/* 顶栏:返回 + 标题 + 新建 */}
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回" testID="history-back">
          <Text style={[styles.back, { color: palette.textSecondary }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{t('historyTitle')}</Text>
        <Pressable onPress={startNew} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.headerAction, { color: accent }]}>{t('newShort')}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={accent} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { borderColor: palette.border }]}>
            <Text style={styles.emptyGlyph}>✎</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>{t('noHistoryTitle')}</Text>
          <Text style={[styles.emptyDesc, { color: palette.textSecondary }]}>{t('noHistoryDesc')}</Text>
          <Pressable style={[styles.cta, { backgroundColor: accent }]} onPress={startNew}>
            <Text style={styles.ctaLabel}>{t('startNew')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}>
          {rows.map((r) => (
            <View key={r.id} style={[styles.item, { backgroundColor: palette.cardBg, borderColor: palette.borderAlt }]}>
              <Pressable style={styles.itemMain} onPress={() => resume(r.id)} testID={`history-row-${r.id}`}>
                <Text style={[styles.itemTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                  {sessionTitleForDisplay(r.title, r.documents?.state?.meta?.title, t('untitled'))}
                </Text>
                <Text style={[styles.itemMeta, { color: palette.textSecondary }]}>{timeAgo(r.updated_at, t)}</Text>
              </Pressable>
              <Pressable
                onPress={() => confirmRemove(r.id)}
                accessibilityRole="button"
                accessibilityLabel={t('deleteWork')}
                style={[styles.deleteBtn, { borderLeftColor: palette.dividerSoft }]}
                testID={`history-delete-${r.id}`}
              >
                <Text style={[styles.deleteGlyph, { color: palette.placeholder }]}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  back: { fontSize: 22, lineHeight: 22, paddingVertical: 4, paddingHorizontal: 6 },
  title: { fontSize: 15, fontWeight: '600' },
  headerAction: { fontSize: 13, fontWeight: '600', paddingVertical: 4, paddingHorizontal: 6 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 18, paddingTop: 16, gap: 10 },
  item: { flexDirection: 'row', alignItems: 'stretch', borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  itemMain: { flex: 1, minWidth: 0, paddingVertical: 14, paddingHorizontal: 16 },
  itemTitle: { fontSize: 15, fontWeight: '600', fontFamily: defaultTheme.fonts.serifTitle, marginBottom: 7 },
  itemMeta: { fontSize: 11 },
  deleteBtn: { width: 46, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1 },
  deleteGlyph: { fontSize: 16 },

  empty: { flex: 1, alignItems: 'center', paddingTop: 70, paddingHorizontal: 30 },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyGlyph: { fontSize: 22, color: '#CFC9BF' },
  emptyTitle: { fontSize: 15, fontWeight: '500', marginBottom: 8 },
  emptyDesc: { fontSize: 13, lineHeight: 22, textAlign: 'center' },
  cta: { marginTop: 24, borderRadius: 14, paddingHorizontal: 26, paddingVertical: 13 },
  ctaLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
