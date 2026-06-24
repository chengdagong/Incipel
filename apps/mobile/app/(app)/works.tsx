// 作品列表:每个会话对应一部作品(它的剧本);点开直接进文档视图(system-design §2.1「作品」/ §10)。
// 视觉对齐最新 handoff 原型「WORKS SCREEN」:自带顶栏(返回 + 标题 + 汉堡)、作品卡、空态。
// 列表用 supabase-js 查 sessions join documents(RLS 按 user_id 隔离,见 §8/§10)。

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Screenplay } from '@incipel/shared';
import { supabase } from '../../src/supabase';
import { MenuButton, timeAgo } from '../../src/components/Drawer';
import { useDrawer } from '../../src/drawer/DrawerProvider';
import { useT } from '../../src/i18n';
import { defaultTheme, palette } from '../../src/theme';

const { accent } = defaultTheme;

// sessions join documents 的查询结果:一会话 ⟷ 一作品(其剧本),严格 1:1(§16)。
type WorkRow = {
  id: string;
  title: string | null;
  starred: boolean;
  updated_at: string;
  documents: { state: Screenplay } | null;
};

export default function WorksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawer = useDrawer();
  const t = useT();
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
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

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }
  function open(id: string) {
    router.push({ pathname: '/chat', params: { sessionId: id, view: 'doc' } });
  }
  function startNew() {
    router.replace('/');
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg, paddingTop: insets.top }]}>
      {/* 顶栏:返回 + 标题 + 汉堡(唤抽屉) */}
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回" testID="works-back">
          <Text style={[styles.back, { color: palette.textSecondary }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{t('worksTitle')}</Text>
        <MenuButton variant="plain" onPress={drawer.open} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={accent} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { borderColor: palette.border }]}>
            <Text style={styles.emptyGlyph}>▢</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>{t('noWorksTitle')}</Text>
          <Text style={[styles.emptyDesc, { color: palette.textSecondary }]}>{t('noWorksDesc')}</Text>
          <Pressable style={[styles.cta, { backgroundColor: accent }]} onPress={startNew}>
            <Text style={styles.ctaLabel}>{t('startNew')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={[styles.intro, { color: palette.textSecondary }]}>{t('worksIntro')}</Text>
          {rows.map((r) => {
            const screenplay = r.documents?.state;
            const logline = screenplay?.meta.logline ?? '';
            return (
              <Pressable
                key={r.id}
                style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.borderAlt }]}
                onPress={() => open(r.id)}
                testID={`work-card-${r.id}`}
              >
                <Text style={[styles.cardTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                  {r.title || screenplay?.meta.title || t('untitled')}
                </Text>
                {!!logline && (
                  <Text style={[styles.logline, { color: palette.textBody }]} numberOfLines={2}>
                    {logline}
                  </Text>
                )}
                <View style={styles.cardFooter}>
                  <Text style={[styles.meta, { color: palette.textSecondary }]}>{timeAgo(r.updated_at, t)}</Text>
                  <Text style={[styles.openWork, { color: accent }]}>{t('openDocWork')}</Text>
                </View>
              </Pressable>
            );
          })}
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 18, paddingTop: 16, gap: 12 },
  intro: { fontSize: 12.5, lineHeight: 20, marginHorizontal: 4, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 17, paddingVertical: 16, gap: 9 },
  cardTitle: { fontSize: 17, fontWeight: '600', fontFamily: defaultTheme.fonts.serifTitle },
  logline: { fontSize: 13, lineHeight: 21 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  meta: { fontSize: 11.5 },
  openWork: { fontSize: 11.5, fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
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
