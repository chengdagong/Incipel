// 设置区共享脚手架:顶栏(返回 + 居中标题)、分组卡、列表行。
// 设置由「类别索引页 → 各详情页」组成(issue #13 之后的重排),五个屏共用同一套外壳,
// 故抽到这里,避免逐屏重复 header / card / row 样式(history / works 各自内联顶栏,本区因屏数多而归并)。
//
// 视觉沿用既有设置页 token:卡片描边 borderAlt、圆角 16、白底;行高与内边距对齐原语言行 / 阅读行。
// 顶栏与 history / works 一致(返回 ‹ + 15/600 标题 + 下边线);不引图标库,沿用文字字形 ‹ / ›。

import { Fragment, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '../theme';

// 顶栏 + 安全区 + 可滚动内容。右侧留与返回等宽的占位,保证标题真正居中。
export function SettingsScreen({
  title,
  children,
  onBack,
  testID,
}: {
  title: string;
  children: ReactNode;
  onBack?: () => void;
  testID?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const back =
    onBack ??
    (() => {
      if (router.canGoBack()) router.back();
      else router.replace('/settings');
    });
  return (
    <View style={[styles.screen, { backgroundColor: palette.pageBg, paddingTop: insets.top }]} testID={testID}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回" testID="settings-back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 30 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>{children}</ScrollView>
    </View>
  );
}

// 分组:可选小标题(节标签)+ 白底卡 + 可选脚注说明;子项之间自动插入左缩进分隔线(iOS 观感)。
export function SettingsGroup({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const items = asArray(children);
  return (
    <View style={[styles.group, style]}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.card}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
    </View>
  );
}

// 列表行:左标签,右侧可放当前值 + 指向箭头(可点)。danger 用语义红(登出等)。
// 传 right 可整体替换右侧(如自定义指示器);不传 onPress 则不显箭头、不可点。
export function SettingsRow({
  label,
  value,
  onPress,
  right,
  danger,
  disabled,
  testID,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const pressable = !!onPress && !disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={!pressable}
      accessibilityRole={onPress ? 'button' : undefined}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && pressable ? styles.rowPressed : null]}
    >
      <Text style={[styles.rowLabel, danger ? { color: palette.danger } : null]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {right !== undefined ? right : onPress ? <Text style={styles.chevron}>›</Text> : null}
      </View>
    </Pressable>
  );
}

function asArray(children: ReactNode): ReactNode[] {
  return Array.isArray(children) ? children.flat().filter((c) => c !== null && c !== false && c !== undefined) : [children];
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
  back: { fontSize: 22, lineHeight: 22, color: palette.textSecondary, paddingVertical: 4, paddingHorizontal: 6 },
  title: { flex: 1, textAlign: 'center', fontSize: 15, color: palette.textPrimary, fontWeight: '600' },

  content: { paddingTop: 18, paddingHorizontal: 18 },

  group: { marginTop: 18 },
  groupTitle: {
    fontSize: 12,
    color: palette.textSecondary,
    letterSpacing: 0.5,
    paddingHorizontal: 6,
    paddingBottom: 9,
  },
  card: { borderWidth: 1, borderColor: palette.borderAlt, borderRadius: 16, backgroundColor: palette.cardBg, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: palette.divider, marginLeft: 16 },
  groupFooter: { fontSize: 12.5, color: palette.textSecondary, lineHeight: 20, paddingTop: 10, paddingHorizontal: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
    backgroundColor: palette.cardBg,
  },
  rowPressed: { backgroundColor: palette.pressedBg },
  rowLabel: { flexShrink: 1, fontSize: 15, color: palette.textPrimary },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowValue: { fontSize: 14, color: palette.textSecondary, maxWidth: 180 },
  chevron: { fontSize: 18, lineHeight: 18, color: palette.placeholder },
});
