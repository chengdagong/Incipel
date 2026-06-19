// 历史会话:全屏会话列表;续写、删除;空状态引导(system-design §2.1「历史会话」/ §10)。
// 列表直接用 supabase-js 查 sessions(RLS 按 user_id 隔离,见 §8)。

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../src/supabase';
import { defaultTheme } from '../src/theme';

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

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.pageBg }]}>
        <ActivityIndicator color={defaultTheme.accent} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: palette.pageBg }]}>
        <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>还没有会话</Text>
        <Text style={[styles.emptySub, { color: palette.textSecondary }]}>
          回到欢迎页,给「织幕」一个灵感开始创作。
        </Text>
        <Pressable
          style={[styles.cta, { backgroundColor: defaultTheme.accent }]}
          onPress={() => router.replace('/')}
        >
          <Text style={styles.ctaLabel}>开始创作</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: palette.pageBg }}
      contentContainerStyle={styles.list}
    >
      {rows.map((r) => (
        <View
          key={r.id}
          style={[styles.item, { backgroundColor: palette.cardBg, borderColor: palette.border }]}
        >
          <Pressable style={styles.itemMain} onPress={() => resume(r.id)}>
            <Text style={[styles.itemTitle, { color: palette.textPrimary }]} numberOfLines={1}>
              {r.starred ? '★ ' : ''}
              {r.title || '未命名作品'}
            </Text>
            <Text style={[styles.itemMeta, { color: palette.textSecondaryAlt }]}>
              {new Date(r.updated_at).toLocaleString()}
            </Text>
          </Pressable>
          <Pressable onPress={() => remove(r.id)} accessibilityRole="button">
            <Text style={[styles.delete, { color: palette.textSecondary }]}>删除</Text>
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
  delete: { fontSize: 13, fontWeight: '600' },
});
