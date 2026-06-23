// 历史消息的展示排序(纯函数,零运行时依赖,便于单测)。
//
// 背景:save_turn 在同一事务内先插 user 再插 assistant 两条 messages(见
// supabase/migrations/0002_reliability_fixes.sql),二者的 created_at 取自 Postgres 的事务级常量
// now()——同一事务内恒等,故两条记录时间戳完全相同。只按 created_at 排序无法保证同一轮里
// user 显示在 assistant 之前(谁先谁后由 Postgres 任意决定)。
//
// 这里在相同时间戳内用角色作稳定次级键,把 user 排到 assistant 之前;不同轮各自是独立事务、
// 时间戳不同,天然按发生先后排列。created_at 为同格式带时区的 ISO 串(均为 +00),字典序即时间序。

export type StoredMessageRow = {
  id: string;
  role: string;
  text: string | null;
  created_at: string;
};

export type DisplayMessage = { id: string; role: 'user' | 'assistant'; content: string };

// 同一时刻内的角色次序:user 在前、assistant 在后。
const ROLE_RANK: Record<string, number> = { user: 0, assistant: 1 };

// 把数据库读出的消息行排成展示用的有序数组:先按 created_at(时间)升序,同一时刻内按角色
// (user→assistant)升序;再同则保持入参的相对次序(稳定)。
export function orderStoredMessages(rows: readonly StoredMessageRow[]): DisplayMessage[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.created_at !== b.r.created_at) return a.r.created_at < b.r.created_at ? -1 : 1;
      const ra = ROLE_RANK[a.r.role] ?? 0;
      const rb = ROLE_RANK[b.r.role] ?? 0;
      if (ra !== rb) return ra - rb;
      return a.i - b.i; // 同一时刻同角色:保持查询返回的相对次序(不依赖引擎的排序稳定性)
    })
    .map(({ r }) => ({
      id: r.id,
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: r.text ?? '',
    }));
}
