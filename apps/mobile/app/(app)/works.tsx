// 作品列表:每个会话对应一部作品(它的剧本);点开直接进文档视图(system-design §2.1「作品」/ §10)。
// 列表用 supabase-js 查 sessions join documents(RLS 按 user_id 隔离,见 §8/§10)。

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { type Screenplay } from '@incipel/shared';
import { supabase } from '../../src/supabase';
import { MenuButton, timeAgo } from '../../src/components/Drawer';
import { useDrawer } from '../../src/drawer/DrawerProvider';
import { useT } from '../../src/i18n';
import { defaultTheme } from '../../src/theme';

// sessions join documents 的查询结果:一会话 ⟷ 一作品(其剧本),严格 1:1(§16)。
type WorkRow = {
  id: string;
  title: string | null;
  starred: boolean;
  updated_at: string;
  // PostgREST 内嵌关联:documents.state 即 Screenplay 对象。
  documents: { state: Screenplay } | null;
};

export default function WorksScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const drawer = useDrawer();
  const t = useT();
  const { palette } = defaultTheme;
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 表头右上汉堡:唤出侧边抽屉(对齐原型作品页顶栏)。
  useEffect(() => {
    navigation.setOptions({
      title: t('worksTitle'),
      headerRight: () => <MenuButton variant="plain" onPress={drawer.open} />,
    });
  }, [navigation, drawer.open, t]);

  const load = useCallback(async () => {
    setLoading(true);
    // documents 与 sessions 1:1,经外键内嵌取出 state(Screenplay)。
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, starred, updated_at, documents(state)')
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('[works] 查询失败:', error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as WorkRow[]);
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

  // 点开作品:进文档视图。会话 id 即 AG-UI 的 threadId,传给 chat;view=doc 让 chat 挂载即开 DocPanel。
  function open(id: string) {
    router.push({ pathname: '/chat', params: { sessionId: id, view: 'doc' } });
  }
  // 空状态「开始新创作」→ 回欢迎页。
  function startNew() {
    router.replace('/');
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
        <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{t('noWorksTitle')}</Text>
        <Text style={[styles.emptySub, { color: palette.textSecondary }]}>{t('noWorksDesc')}</Text>
        <Pressable style={[styles.cta, { backgroundColor: defaultTheme.accent }]} onPress={startNew}>
          <Text style={styles.ctaLabel}>{t('startNew')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: palette.pageBg }} contentContainerStyle={styles.list}>
      <Text style={[styles.intro, { color: palette.textSecondaryAlt }]}>{t('worksIntro')}</Text>
      {rows.map((r) => {
        const screenplay = r.documents?.state;
        const logline = screenplay?.meta.logline ?? '';
        return (
          <Pressable
            key={r.id}
            style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.border }]}
            onPress={() => open(r.id)}
          >
            <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={1}>
              {r.starred ? '★ ' : ''}
              {r.title || screenplay?.meta.title || t('untitled')}
            </Text>
            {!!logline && (
              <Text style={[styles.logline, { color: palette.textSecondary }]} numberOfLines={2}>
                {logline}
              </Text>
            )}
            <View style={styles.cardFooter}>
              <Text style={[styles.meta, { color: palette.textSecondaryAlt }]}>{timeAgo(r.updated_at, t)}</Text>
              <Text style={[styles.openWork, { color: defaultTheme.accent }]}>{t('openDocWork')}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', fontFamily: defaultTheme.fonts.serifTitle },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cta: { borderRadius: 14, paddingHorizontal: 26, paddingVertical: 13, marginTop: 12 },
  ctaLabel: { color: '#fff', fontWeight: '600', fontSize: 14 },
  list: { padding: 16, gap: 12 },
  intro: { fontSize: 12.5, lineHeight: 20, marginHorizontal: 4, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 9 },
  title: { fontSize: 17, fontWeight: '700', fontFamily: defaultTheme.fonts.serifTitle },
  logline: { fontSize: 13, lineHeight: 21 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  meta: { fontSize: 11.5 },
  openWork: { fontSize: 11.5, fontWeight: '600' },
});
