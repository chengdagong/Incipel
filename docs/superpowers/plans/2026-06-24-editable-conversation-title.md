# Editable Conversation Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click a conversation title, edit it manually, and persist the same title into both `sessions.title` and `documents.state.meta.title`.

**Architecture:** Add a narrow Postgres function for authenticated users to update only their own session title and the matching screenplay title. Keep the client away from direct `documents.state` writes, and expose local title updates through `useScreenplayAgent` so the chat header and document panel refresh immediately after a successful save.

**Tech Stack:** Supabase Postgres migrations, pgTAP, React Native / Expo, TypeScript, Vitest.

## Global Constraints

- Client code must not receive table-level permission to update `documents.state`.
- User title edits must not create chat messages and must not call the model.
- Title input must be trimmed and limited to 80 characters.
- Empty title is allowed and displays as the existing untitled copy.
- Chinese documentation, comments, and commit messages must follow `plain-chinese` rules.

---

### Task 1: Database Write Path

**Files:**
- Create: `supabase/migrations/0005_edit_session_title.sql`
- Modify: `supabase/tests/rls_test.sql`

**Interfaces:**
- Consumes: `public.sessions`, `public.documents`, current `public.save_turn(uuid, text, text, text, jsonb, jsonb, jsonb, boolean)`.
- Produces: `public.update_session_title(p_session_id uuid, p_title text) returns table(title text, updated_at timestamptz)`.

- [ ] **Step 1: Write failing pgTAP tests**

Add tests to `supabase/tests/rls_test.sql`:

```sql
select lives_ok(
  $$ select * from public.update_session_title(
       '11111111-0000-0000-0000-0000000000a1'::uuid,
       '  用户标题  ') $$,
  'A 能通过 RPC 修改自己的会话标题');

select is(
  (select title from public.sessions where id = '11111111-0000-0000-0000-0000000000a1'),
  '用户标题',
  'RPC 会更新 sessions.title');

select is(
  (select state #>> '{meta,title}' from public.documents where session_id = '11111111-0000-0000-0000-0000000000a1'),
  '用户标题',
  'RPC 会更新 documents.state.meta.title');

select throws_ok(
  $$ select * from public.update_session_title(
       '22222222-0000-0000-0000-0000000000b1'::uuid,
       '偷改标题') $$,
  'P0001', '会话不存在或不属于该用户',
  'A 不能通过 RPC 修改 B 的会话标题');

select throws_ok(
  $$ update public.sessions set title = '直接写标题'
     where id = '11111111-0000-0000-0000-0000000000a1' $$,
  '42501', null,
  'authenticated 仍不能直接 update sessions.title');
```

- [ ] **Step 2: Run database tests and verify failure**

Run:

```bash
supabase test db
```

Expected: `rls_test.sql` fails because `public.update_session_title` does not exist.

- [ ] **Step 3: Add migration**

Create `supabase/migrations/0005_edit_session_title.sql` with:

```sql
create or replace function public.update_session_title(
  p_session_id uuid,
  p_title text
) returns table(title text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := left(btrim(coalesce(p_title, '')), 80);
  v_updated_at timestamptz := clock_timestamp();
  v_updated_at_iso text := to_char(v_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_user_id is null then
    raise exception '未登录';
  end if;

  update public.sessions
     set title = v_title,
         updated_at = v_updated_at
   where id = p_session_id
     and user_id = v_user_id;

  if not found then
    raise exception '会话不存在或不属于该用户';
  end if;

  update public.documents
     set state = jsonb_set(
       jsonb_set(state, '{meta,title}', to_jsonb(v_title), true),
       '{meta,updatedAt}', to_jsonb(v_updated_at_iso), true
     )
   where session_id = p_session_id;

  return query select v_title, v_updated_at;
end;
$$;
```

Also recreate `save_turn` so it sets `sessions.title = coalesce(p_state #>> '{meta,title}', '')` together with `updated_at`.

- [ ] **Step 4: Run database tests and verify pass**

Run:

```bash
supabase test db
```

Expected: `rls_test.sql` and `reliability_test.sql` pass.

### Task 2: Mobile Title Helpers And Hook

**Files:**
- Create: `apps/mobile/src/session-title.ts`
- Create: `apps/mobile/src/session-title.test.ts`
- Modify: `apps/mobile/src/agui/client.ts`

**Interfaces:**
- Produces: `normalizeSessionTitle(input: string): string`.
- Produces: `applyScreenplayTitle(screenplay: Screenplay, title: string, updatedAt?: string): Screenplay`.
- Produces: `useScreenplayAgent(...).applyLocalTitle(title: string, updatedAt?: string): void`.

- [ ] **Step 1: Write failing helper tests**

Create `apps/mobile/src/session-title.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyScreenplay } from '@incipel/shared';
import { applyScreenplayTitle, normalizeSessionTitle } from './session-title';

describe('normalizeSessionTitle', () => {
  it('去掉首尾空白并限制为 80 个字符', () => {
    expect(normalizeSessionTitle(`  ${'甲'.repeat(90)}  `)).toBe('甲'.repeat(80));
  });
});

describe('applyScreenplayTitle', () => {
  it('只更新 meta.title 与 meta.updatedAt', () => {
    const screenplay = { ...emptyScreenplay(), world: [{ id: 'world_1', title: '旧世界', text: '正文' }] };
    const next = applyScreenplayTitle(screenplay, '新标题', '2026-06-24T00:00:00.000Z');
    expect(next.meta.title).toBe('新标题');
    expect(next.meta.updatedAt).toBe('2026-06-24T00:00:00.000Z');
    expect(next.world).toBe(screenplay.world);
  });
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
pnpm --filter @incipel/mobile test -- session-title.test.ts
```

Expected: test fails because `apps/mobile/src/session-title.ts` does not exist.

- [ ] **Step 3: Implement helpers and hook API**

Create helpers:

```ts
export const SESSION_TITLE_MAX_LENGTH = 80;

export function normalizeSessionTitle(input: string): string {
  return String(input ?? '').trim().slice(0, SESSION_TITLE_MAX_LENGTH);
}
```

In `useScreenplayAgent`, add:

```ts
const applyLocalTitle = useCallback((title: string, updatedAt?: string) => {
  const agent = agentRef.current!;
  const next = applyScreenplayTitle(agent.state as Screenplay, title, updatedAt);
  agent.setState(next as unknown as Record<string, unknown>);
  setScreenplay(next);
}, []);
```

- [ ] **Step 4: Run helper tests and verify pass**

Run:

```bash
pnpm --filter @incipel/mobile test -- session-title.test.ts
```

Expected: test passes.

### Task 3: Chat Editing UI

**Files:**
- Modify: `apps/mobile/app/(app)/chat.tsx`
- Modify: `apps/mobile/src/i18n.tsx`

**Interfaces:**
- Consumes: `normalizeSessionTitle`, `applyLocalTitle`.
- Consumes: Supabase RPC `update_session_title`.

- [ ] **Step 1: Add editable header behavior**

Change the header title area into a pressable title that switches to `TextInput`. On submit or blur, call:

```ts
await supabase.rpc('update_session_title', {
  p_session_id: threadId,
  p_title: normalizeSessionTitle(nextTitle),
});
```

Then call `applyLocalTitle(title, updatedAtIso)` using the returned row.

- [ ] **Step 2: Add localized copy**

Add keys in all languages:

```ts
renameTitle: '修改标题',
renameTitleFailed: '标题保存失败,请稍后重试。',
```

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @incipel/mobile typecheck
```

Expected: typecheck passes.

### Task 4: Lists And Documentation

**Files:**
- Modify: `apps/mobile/app/(app)/history.tsx`
- Modify: `supabase/README.md`
- Modify: `docs/system-design.md`

**Interfaces:**
- Consumes: `documents(state)` in history query.
- Consumes: `normalizeSessionTitle` / display fallback if reused.

- [ ] **Step 1: Make history title fallback match works and drawer**

Change the history query to:

```ts
.select('id, title, accent, starred, updated_at, documents(state)')
```

Display title as `r.title || r.documents?.state?.meta?.title || t('untitled')`.

- [ ] **Step 2: Update docs**

Update `supabase/README.md` and `docs/system-design.md` to mention `update_session_title` and the manual title editing action.

- [ ] **Step 3: Run final checks**

Run:

```bash
pnpm --filter @incipel/mobile test -- session-title.test.ts
pnpm --filter @incipel/mobile typecheck
supabase test db
git diff --check
```

Expected: all commands exit 0.
