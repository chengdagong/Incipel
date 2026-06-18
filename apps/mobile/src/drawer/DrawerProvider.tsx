// 全局抽屉:挂在根布局,任意屏用 useDrawer().open() 唤出(欢迎页菜单、作品页菜单)。
// 数据(会话列表、收藏/最近)直接用 supabase-js 查 sessions(RLS 按 user_id 隔离,见 system-design §8/§10),
// 与 history / works 屏一致;收藏开关 update sessions.starred。
//
// 为什么用 Provider 而非每屏各放一份:原型里抽屉是覆盖全应用的浮层(从欢迎页、作品页都能唤出),
// 挂一处、各屏共享开关与数据最贴合,也避免重复挂载浮层。

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../supabase';
import { DrawerOverlay, type DrawerSession } from '../components/Drawer';

type DrawerApi = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  reload: () => void;
};

const DrawerContext = createContext<DrawerApi | null>(null);

export function useDrawer(): DrawerApi {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error('useDrawer 必须在 DrawerProvider 内使用');
  return ctx;
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<DrawerSession[]>([]);

  const reload = useCallback(async () => {
    // RLS 已把结果限定在当前(匿名)用户;按更新时间倒序(「最近」)。
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, starred, updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      // Supabase 未配置/不可达(本地 dev 走 agent 的 STORE=memory)时,静默给空列表。
      console.warn('[drawer] 查询会话失败:', error.message);
      setSessions([]);
      return;
    }
    setSessions(
      (data ?? []).map((r) => ({
        id: r.id as string,
        title: (r.title as string | null) ?? '',
        starred: !!r.starred,
        updatedAt: r.updated_at as string,
      })),
    );
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    void reload(); // 每次打开拉一遍最新列表
  }, [reload]);

  const close = useCallback(() => setIsOpen(false), []);

  // 收藏开关:乐观更新,失败回滚(system-design §10:直接 update sessions 行,RLS 保护)。
  const toggleStar = useCallback(async (id: string) => {
    let next = false;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          next = !s.starred;
          return { ...s, starred: next };
        }
        return s;
      }),
    );
    const { error } = await supabase.from('sessions').update({ starred: next }).eq('id', id);
    if (error) {
      console.warn('[drawer] 收藏切换失败:', error.message);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, starred: !next } : s)));
    }
  }, []);

  const starred = useMemo(() => sessions.filter((s) => s.starred), [sessions]);
  const recent = useMemo(() => sessions.filter((s) => !s.starred), [sessions]);

  const api = useMemo<DrawerApi>(() => ({ isOpen, open, close, reload }), [isOpen, open, close, reload]);

  return (
    <DrawerContext.Provider value={api}>
      <View style={styles.root}>
        {children}
        <DrawerOverlay
          open={isOpen}
          onClose={close}
          starred={starred}
          recent={recent}
          sessionCount={sessions.length}
          // 新建创作:回到空白欢迎页(原型 newFromDrawer = 关抽屉 + newFromHistory)。
          onNew={() => {
            close();
            router.replace('/');
          }}
          // 「会话」→ 历史列表。
          onOpenSessions={() => {
            close();
            router.push('/history');
          }}
          // 打开某条会话:会话 id 即 AG-UI threadId,交给 chat 续写(system-design §10)。
          onOpenSession={(id) => {
            close();
            router.push({ pathname: '/chat', params: { sessionId: id } });
          }}
          onToggleStar={toggleStar}
          // 抽屉头像 → 设置页(含多语言,见 issue #13)。
          onOpenSettings={() => {
            close();
            router.push('/settings');
          }}
        />
      </View>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
