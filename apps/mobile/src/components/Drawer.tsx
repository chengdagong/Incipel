// 侧边抽屉(全局浮层):菜单入口 + 新建创作 + 会话(历史)+ 收藏/最近两段 + 悬浮新建按钮
// (system-design §2.1「侧栏抽屉」,交互见 handoff 的 interactions.feature「侧边抽屉导航」)。
//
// 视觉对齐原型「编剧助手 原型.dc.html」的 SIDEBAR DRAWER:从左滑出的 308px 面板 + 半透明遮罩。
// 原型用内联 SVG 画图标;本仓库刻意零图标库(RN 集成坑见 apps/mobile/README.md),
// 故汉堡用三条 View、星标用 ★/☆ 字形,与既有组件(‹ ↑ ▸)同风格。

import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defaultTheme, palette, type Theme } from '../theme';
import { useT, type I18nApi } from '../i18n';
import { PRODUCT_NAME } from '../config';

// 抽屉里的一条会话(= 一部作品,严格 1:1,见 system-design §16)。
export type DrawerSession = {
  id: string;
  title: string;
  starred: boolean;
  updatedAt: string; // ISO
};

// drawer 各处用色统一引自通用 palette(过去这里是逐像素对齐原型的字面色表,已归并)。
// 次要文字 / 时间 / 计数 / 空态原先是 #A39E94 / #B3AEA4 / #9A958C 一类浅灰(对比 ~2.x:1),
// 现统一走 palette.textSecondary(≈ 5.6:1)。
const DRAWER = {
  panelBg: palette.panelBg,
  backdrop: palette.scrim,
  brand: palette.textPrimary,
  avatarBg: palette.avatarBg,
  navText: palette.textPrimary,
  navIcon: palette.textPrimaryAlt,
  navPressed: palette.pressedBg,
  sectionLabel: palette.textSecondary,
  itemTitle: palette.textPrimary,
  itemTime: palette.textSecondary,
  count: palette.textSecondary,
  starOutline: palette.textSecondary,
  emptyText: palette.textSecondary,
  floatBg: palette.avatarBg,
} as const;

type Props = {
  theme?: Theme;
  open: boolean;
  onClose: () => void;
  starred: DrawerSession[];
  recent: DrawerSession[];
  sessionCount: number;
  // 抽屉顶栏右上头像里的字(匿名默认「你」;账号体系在另一 worktree,设置入口暂为占位)。
  accountInitial?: string;
  onNew: () => void;
  onOpenSessions: () => void; // 「会话」→ 历史列表
  onOpenSession: (id: string) => void;
  onToggleStar: (id: string) => void;
  onOpenSettings?: () => void; // 设置页未实现时不传,头像渲染为非交互品牌标
};

export function timeAgo(iso: string, tr: I18nApi['t']): string {
  const ms = new Date(iso).getTime();
  if (!ms || Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return tr('timeJustNow');
  if (m < 60) return tr('timeMin', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tr('timeHour', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return tr('timeDay', { n: d });
  return new Date(ms).toLocaleDateString();
}

export function DrawerOverlay({
  theme = defaultTheme,
  open,
  onClose,
  starred,
  recent,
  sessionCount,
  accountInitial,
  onNew,
  onOpenSessions,
  onOpenSession,
  onToggleStar,
  onOpenSettings,
}: Props) {
  const insets = useSafeAreaInsets();
  const t = useT();
  // 匿名默认取「你」首字(账号体系在另一 worktree;有账号后由调用方传 accountInitial)。
  const initial = accountInitial ?? t('guestName').charAt(0) ?? '你';
  const { width } = useWindowDimensions();
  // 原型:width 308px,max-width 84%。
  const panelWidth = Math.min(308, width * 0.84);
  // 关闭时滑出屏外(原型 translateX(-104%))。
  const closedX = -(panelWidth + 24);

  // 单一进度值驱动遮罩透明度与面板位移(原型 transition .3s / .34s)。
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: open ? 340 : 260,
      useNativeDriver: true,
    }).start();
  }, [open, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [closedX, 0] });

  const empty = sessionCount === 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      {/* 遮罩:点击关闭 */}
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭抽屉" />
      </Animated.View>

      {/* 面板 */}
      <Animated.View
        style={[styles.panel, { width: panelWidth, transform: [{ translateX }] }]}
      >
        {/* 顶栏:品牌「织幕」+ 头像/设置入口 */}
        <View style={[styles.header, { paddingTop: insets.top + 18 }]}>
          <Text style={styles.brand}>{PRODUCT_NAME}</Text>
          {onOpenSettings ? (
            <Pressable
              style={styles.avatar}
              onPress={onOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="设置"
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          )}
        </View>

        {/* 导航:新建创作 / 会话 */}
        <View style={styles.nav}>
          <NavRow icon={<PencilIcon />} label={t('newChat')} onPress={onNew} />
          <NavRow
            icon={<BubbleIcon />}
            label={t('sessions')}
            onPress={onOpenSessions}
            trailing={<Text style={styles.count}>{sessionCount}</Text>}
          />
        </View>

        {/* 列表:收藏 + 最近 */}
        <ScrollView style={styles.lists} contentContainerStyle={styles.listsContent}>
          {empty ? (
            <Text style={styles.emptyText}>{t('noSessionsDrawer')}</Text>
          ) : (
            <>
              {starred.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>{t('starred')}</Text>
                  {starred.map((s) => (
                    <SessionRow
                      key={s.id}
                      title={s.title || t('untitled')}
                      starred
                      accent={theme.accent}
                      t={t}
                      onOpen={() => onOpenSession(s.id)}
                      onToggleStar={() => onToggleStar(s.id)}
                    />
                  ))}
                </View>
              )}
              {recent.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>{t('recent')}</Text>
                  {recent.map((s) => (
                    <SessionRow
                      key={s.id}
                      title={s.title || t('untitled')}
                      subtitle={timeAgo(s.updatedAt, t)}
                      accent={theme.accent}
                      t={t}
                      onOpen={() => onOpenSession(s.id)}
                      onToggleStar={() => onToggleStar(s.id)}
                    />
                  ))}
                </View>
              )}
            </>
          )}
          <View style={{ height: 80 }} />
        </ScrollView>

        {/* 悬浮新建按钮 */}
        <Pressable
          style={[styles.floatNew, { bottom: insets.bottom + 26 }]}
          onPress={onNew}
          accessibilityRole="button"
        >
          <Text style={styles.floatPlus}>＋</Text>
          <Text style={styles.floatLabel}>{t('newChat')}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function NavRow({
  icon,
  label,
  onPress,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: DRAWER.navPressed }]}
      accessibilityRole="button"
    >
      <View style={styles.navIconWrap}>{icon}</View>
      <Text style={styles.navText}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

function SessionRow({
  title,
  subtitle,
  starred,
  accent,
  t,
  onOpen,
  onToggleStar,
}: {
  title: string;
  subtitle?: string;
  starred?: boolean;
  accent: string;
  t: I18nApi['t'];
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  return (
    <View style={styles.sessionRow}>
      <Pressable
        style={({ pressed }) => [styles.sessionMain, pressed && { backgroundColor: DRAWER.navPressed }]}
        onPress={onOpen}
        accessibilityRole="button"
      >
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && <Text style={styles.sessionTime}>{subtitle}</Text>}
      </Pressable>
      <Pressable
        style={styles.starBtn}
        onPress={onToggleStar}
        accessibilityRole="button"
        accessibilityLabel={starred ? t('unstarTitle') : t('starTitle')}
        hitSlop={6}
      >
        {starred ? (
          <Text style={[styles.starGlyph, { color: accent }]}>★</Text>
        ) : (
          <Text style={[styles.starGlyph, styles.starOutline]}>☆</Text>
        )}
      </Pressable>
    </View>
  );
}

// 汉堡按钮(欢迎页 circle 变体 / 列表页 plain 变体)。原型用 CSS 三条;这里用三条 View。
export function MenuButton({
  variant = 'circle',
  onPress,
}: {
  variant?: 'circle' | 'plain';
  onPress: () => void;
}) {
  const t = useT();
  const circle = variant === 'circle';
  const barColor = circle ? '#56524B' : palette.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('menuTitle')}
      hitSlop={8}
      style={({ pressed }) => [
        circle ? styles.menuCircle : styles.menuPlain,
        pressed && circle && { backgroundColor: '#EBE7DF' },
      ]}
    >
      <View style={styles.menuBars}>
        <View style={[styles.menuBar, { width: circle ? 17 : 15, backgroundColor: barColor }]} />
        <View style={[styles.menuBar, { width: circle ? 17 : 15, backgroundColor: barColor }]} />
        <View style={[styles.menuBar, { width: circle ? 11 : 10, backgroundColor: barColor }]} />
      </View>
    </Pressable>
  );
}

// 铅笔(新建)与会话气泡:零依赖的小图标,用基础 View 画。
function PencilIcon() {
  return <Text style={styles.glyphIcon}>✎</Text>;
}
function BubbleIcon() {
  return <View style={styles.bubbleIcon} />;
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: DRAWER.backdrop },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: DRAWER.panelBg,
    shadowColor: '#28241E',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 16,
    flexDirection: 'column',
  },

  header: {
    paddingHorizontal: 22,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontFamily: defaultTheme.fonts.serifTitle,
    fontSize: 22,
    fontWeight: '600',
    color: DRAWER.brand,
    letterSpacing: 0.5,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: DRAWER.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  nav: { paddingHorizontal: 12, paddingTop: 6, gap: 2 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 11,
  },
  navIconWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 16, color: DRAWER.navText },
  count: { marginLeft: 'auto', fontSize: 12, color: DRAWER.count },
  glyphIcon: { fontSize: 17, color: DRAWER.navIcon },
  bubbleIcon: {
    width: 18,
    height: 14,
    borderWidth: 1.6,
    borderColor: DRAWER.navIcon,
    borderRadius: 5,
    borderBottomLeftRadius: 1,
  },

  lists: { flex: 1 },
  listsContent: { paddingHorizontal: 12, paddingTop: 14 },
  section: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 12,
    color: DRAWER.sectionLabel,
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  sessionRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 11 },
  sessionMain: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 11,
    gap: 2,
  },
  sessionTitle: { fontSize: 15, color: DRAWER.itemTitle },
  sessionTime: { fontSize: 11.5, color: DRAWER.itemTime },
  starBtn: { width: 34, height: 42, alignItems: 'center', justifyContent: 'center' },
  starGlyph: { fontSize: 16 },
  starOutline: { color: DRAWER.starOutline, opacity: 0.6 },

  emptyText: {
    paddingVertical: 40,
    paddingHorizontal: 16,
    textAlign: 'center',
    color: DRAWER.emptyText,
    fontSize: 13,
    lineHeight: 22,
  },

  floatNew: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 14,
    backgroundColor: DRAWER.floatBg,
    shadowColor: '#28241E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },
  floatPlus: { color: '#fff', fontSize: 18, lineHeight: 18 },
  floatLabel: { color: '#fff', fontSize: 14.5, fontWeight: '600' },

  menuCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2EFE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuPlain: { paddingHorizontal: 6, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  menuBars: { gap: 3.5, alignItems: 'flex-start' },
  menuBar: { height: 1.8, borderRadius: 2 },
});
