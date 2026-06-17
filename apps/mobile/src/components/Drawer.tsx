// 侧栏抽屉:新建创作、会话列表、作品列表;收藏(starred)+ 最近(recent)两段
// (system-design §2.1「侧栏抽屉」)。这里是带基础样式的骨架,数据由上层传入。

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { defaultTheme, type Theme } from '../theme';

// 侧栏条目:一个会话(= 一部作品,严格 1:1,见 system-design §16)。
export type DrawerItem = {
  sessionId: string;
  title: string;
  starred: boolean;
};

type Props = {
  theme?: Theme;
  starred: DrawerItem[];
  recent: DrawerItem[];
  onNew: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenHistory: () => void;
  onOpenWorks: () => void;
};

export function Drawer({
  theme = defaultTheme,
  starred,
  recent,
  onNew,
  onOpenSession,
  onOpenHistory,
  onOpenWorks,
}: Props) {
  const { palette } = theme;
  return (
    <View style={[styles.drawer, { backgroundColor: palette.pageBg }]}>
      <Pressable
        style={[styles.newBtn, { backgroundColor: theme.accent }]}
        onPress={onNew}
        accessibilityRole="button"
      >
        <Text style={styles.newLabel}>＋ 新建创作</Text>
      </Pressable>

      <View style={styles.navRow}>
        <NavLink label="历史会话" onPress={onOpenHistory} theme={theme} />
        <NavLink label="作品" onPress={onOpenWorks} theme={theme} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Group label="收藏" items={starred} theme={theme} onOpenSession={onOpenSession} />
        <Group label="最近" items={recent} theme={theme} onOpenSession={onOpenSession} />
      </ScrollView>
    </View>
  );
}

function NavLink({ label, onPress, theme }: { label: string; onPress: () => void; theme: Theme }) {
  return (
    <Text
      style={[styles.navLink, { color: theme.palette.textSecondary }]}
      onPress={onPress}
      accessibilityRole="button"
    >
      {label}
    </Text>
  );
}

function Group({
  label,
  items,
  theme,
  onOpenSession,
}: {
  label: string;
  items: DrawerItem[];
  theme: Theme;
  onOpenSession: (sessionId: string) => void;
}) {
  const { palette } = theme;
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: palette.textSecondaryAlt }]}>{label}</Text>
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: palette.textSecondaryAlt }]}>暂无</Text>
      ) : (
        items.map((it) => (
          <Pressable key={it.sessionId} onPress={() => onOpenSession(it.sessionId)}>
            <Text style={[styles.item, { color: palette.textPrimary }]} numberOfLines={1}>
              {it.starred ? '★ ' : ''}
              {it.title || '未命名作品'}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1, padding: 16, gap: 16 },
  newBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  newLabel: { color: '#fff', fontWeight: '600', fontSize: 15 },
  navRow: { flexDirection: 'row', gap: 16 },
  navLink: { fontSize: 14, fontWeight: '600' },
  list: { gap: 20 },
  group: { gap: 8 },
  groupLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  empty: { fontSize: 13, fontStyle: 'italic' },
  item: { fontSize: 15, paddingVertical: 6 },
});
