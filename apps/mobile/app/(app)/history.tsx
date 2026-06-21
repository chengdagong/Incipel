// 历史会话:全屏会话列表;续写、删除;空状态引导(system-design §2.1「历史会话」/ §10)。
// 列表直接用 supabase-js 查 sessions(RLS 按 user_id 隔离,见 §8)。

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useT } from '../../src/i18n';
import { supabase } from '../../src/supabase';
import { defaultTheme } from '../../src/theme';

// sessions 行的子集(见 system-design §8 数据模型)。
type SessionRow = {
  id: string;
  title: string | null;
  accent: string | null;
  starred: boolean;
  updated_at: string;
};

export default function HistoryScreen() {
  const router = useRouter();
  const t = useT();
  const { palette } = defaultTheme;
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // RLS 已把结果限定在当前(匿名)用户;无需手动加 user_id 过滤。
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, accent, starred, updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('[history] 查询失败:', error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as SessionRow[]);
    }
    setLoading(false);
  }, []);

  // 进入屏幕时刷新。
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => {
    load();
  }, [load]);

  // 续写:打开该会话。会话 id 即 AG-UI 的 threadId —— 传给 chat,chat 用它建 HttpAgent;
  // agent 端据 threadId 载入 documents.state + 最近 messages 续写(system-design §6.2 / §10)。
  function resume(id: string) {
    router.push({ pathname: '/chat', params: { sessionId: id } });
  }

  // 删除会话(直接 delete sessions 行,RLS 保护;关联表按外键级联,见 §10）。
  async function remove(id: string) {
    const { error } = await supabase.from('sessions').delete().eq('id', id);
    if (error) {
      console.warn('[history] 删除失败:', error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  // 删除是破坏性且不可恢复的:先二次确认(与设置页登出一致),用户确认后再删。
  // 注意:react-native-web 的 Alert.alert 是空实现——既不弹窗也不回调 onPress,
  // 在 Expo Web 上会让「删除」点了毫无反应。故 Web 走浏览器原生 confirm,原生端走 Alert。
  // 用 globalThis 取 confirm(不依赖 DOM lib 类型);取不到时按「未确认」处理,绝不静默删除。
  function confirmRemove(id: string) {
    if (Platform.OS === 'web') {
      const g = globalThis as unknown as { confirm?: (message: string) => boolean };
      const ok = typeof g.confirm === 'function'
        ? g.confirm(`${t('deleteConfirm')}\n\n${t('deleteConfirmSub')}`)
        : false;
      if (ok) void remove(id);
      return;
    }
    Alert.alert(t('deleteConfirm'), t('deleteConfirmSub'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('deleteWork'), style: 'destructive', onPress: () => void remove(id) },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.pageBg }]}>
        <Stack.Screen options={{ title: t('historyTitle') }} />
        <ActivityIndicator color={defaultTheme.accent} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: palette.pageBg }]}>
        <Stack.Screen options={{ title: t('historyTitle') }} />
        <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{t('noHistoryTitle')}</Text>
        <Text style={[styles.emptySub, { color: palette.textSecondary }]}>{t('noHistoryDesc')}</Text>
        <Pressable
          style={[styles.cta, { backgroundColor: defaultTheme.accent }]}
          onPress={() => router.replace('/')}
        >
          <Text style={styles.ctaLabel}>{t('startNew')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: palette.pageBg }}
      contentContainerStyle={styles.list}
    >
      <Stack.Screen options={{ title: t('historyTitle') }} />
      {rows.map((r) => (
        <View
          key={r.id}
          style={[styles.item, { backgroundColor: palette.cardBg, borderColor: palette.border }]}
        >
          <Pressable style={styles.itemMain} onPress={() => resume(r.id)} testID={`history-row-${r.id}`}>
            <Text style={[styles.itemTitle, { color: palette.textPrimary }]} numberOfLines={1}>
              {r.starred ? '★ ' : ''}
              {r.title || t('untitled')}
            </Text>
            <Text style={[styles.itemMeta, { color: palette.textSecondary }]}>
              {new Date(r.updated_at).toLocaleString()}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => confirmRemove(r.id)}
            accessibilityRole="button"
            accessibilityLabel={t('deleteWork')}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            style={styles.deleteBtn}
            testID={`history-delete-${r.id}`}
          >
            <Text style={[styles.delete, { color: palette.textSecondary }]}>{t('deleteWork')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', fontFamily: defaultTheme.fonts.serifTitle },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cta: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  ctaLabel: { color: '#fff', fontWeight: '600' },
  list: { padding: 16, gap: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  itemMain: { flex: 1, gap: 4 },
  itemTitle: { fontSize: 16, fontWeight: '600', fontFamily: defaultTheme.fonts.serifTitle },
  itemMeta: { fontSize: 12 },
  deleteBtn: { paddingVertical: 10, paddingHorizontal: 6 },
  delete: { fontSize: 13, fontWeight: '600' },
});
