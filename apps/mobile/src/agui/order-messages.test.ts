import { describe, expect, it } from 'vitest';
import { orderStoredMessages, type StoredMessageRow } from './order-messages';

describe('orderStoredMessages', () => {
  // 回归:打开已有会话恢复历史时,同一轮的 user 与 assistant 由 save_turn 在同一事务内写入,
  // created_at 相同(Postgres 事务内 now() 恒等);只按时间排会让同轮先后随机。必须保证
  // 同一时刻内 user 显示在 assistant 之前,且不同轮按时间先后排列。
  it('orders turns by time and puts user before assistant within the same timestamp', () => {
    // 故意把每轮的 assistant 行放在 user 行之前(模拟 Postgres 对相同 created_at 的任意返回次序)。
    const rows: StoredMessageRow[] = [
      { id: 'a-asst', role: 'assistant', text: 'A助手', created_at: '2026-06-23T12:34:59+00:00' },
      { id: 'a-user', role: 'user', text: 'A用户', created_at: '2026-06-23T12:34:59+00:00' },
      { id: 'c-user', role: 'user', text: 'C用户', created_at: '2026-06-23T12:30:00+00:00' },
      { id: 'c-asst', role: 'assistant', text: 'C助手', created_at: '2026-06-23T12:30:00+00:00' },
      { id: 'b-asst', role: 'assistant', text: 'B助手', created_at: '2026-06-23T12:32:00+00:00' },
      { id: 'b-user', role: 'user', text: 'B用户', created_at: '2026-06-23T12:32:00+00:00' },
    ];

    expect(orderStoredMessages(rows).map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:C用户',
      'assistant:C助手',
      'user:B用户',
      'assistant:B助手',
      'user:A用户',
      'assistant:A助手',
    ]);
  });

  it('keeps a turn that has only an assistant message (empty user text is not persisted)', () => {
    // save_turn 仅当本轮有用户文本时才写 user 行;有的轮只有 assistant。
    const rows: StoredMessageRow[] = [
      { id: 'only-asst', role: 'assistant', text: '仅助手', created_at: '2026-06-23T12:30:00+00:00' },
    ];
    expect(orderStoredMessages(rows)).toEqual([{ id: 'only-asst', role: 'assistant', content: '仅助手' }]);
  });

  it('coerces null text to empty string and unknown roles to user', () => {
    const rows: StoredMessageRow[] = [
      { id: 'x', role: 'system', text: null, created_at: '2026-01-01T00:00:00+00:00' },
    ];
    expect(orderStoredMessages(rows)).toEqual([{ id: 'x', role: 'user', content: '' }]);
  });

  it('returns empty array for no rows', () => {
    expect(orderStoredMessages([])).toEqual([]);
  });
});
