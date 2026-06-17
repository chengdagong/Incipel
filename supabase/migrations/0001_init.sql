-- 「芯」(Incipel)初始 schema:sessions / documents / document_versions / messages。
-- 数据模型见 docs/system-design.md §8;RLS 按 user_id 隔离见 §8 末与 §4。
-- 一会话 ⟷ 一剧本严格 1:1;documents.state 存当前权威剧本(@incipel/shared 的 Screenplay)。

-- 生成 uuid 用(gen_random_uuid 来自该扩展)。
create extension if not exists "pgcrypto" with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 表
-- ─────────────────────────────────────────────────────────────────────────────

-- 会话:用户与「芯」推进一部剧本的那条对话线。匿名与正式用户一视同仁。
create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text,
  accent      text,
  starred     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index sessions_user_id_idx on public.sessions (user_id);
-- 列表常按更新时间倒序展示「最近」。
create index sessions_user_updated_idx on public.sessions (user_id, updated_at desc);

-- 当前权威剧本,与 session 1:1(session_id 作主键即强制 1:1)。
create table public.documents (
  session_id  uuid primary key references public.sessions (id) on delete cascade,
  state       jsonb not null
);

-- 粗粒度历史:每个「剧本真有改动」的轮写一版,支持撤销/回退。
create table public.document_versions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  turn_index  integer not null,
  state       jsonb not null,
  created_at  timestamptz not null default now()
);

create index document_versions_session_idx on public.document_versions (session_id);
-- 取「该会话当前最大 turn_index」与按轮排序用;同时杜绝同一会话重复轮号。
create unique index document_versions_session_turn_idx
  on public.document_versions (session_id, turn_index);

-- 对话消息。assistant 消息额外记本轮产生的 STATE_DELTA 与可点选项,
-- 续聊旧会话时历史内联卡片照原样重渲染,不必重算(见 §8)。
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  text        text,
  deltas      jsonb,
  options     jsonb,
  created_at  timestamptz not null default now()
);

create index messages_session_idx on public.messages (session_id);
-- 续写会话时按时间正序拉取对话流。
create index messages_session_created_idx on public.messages (session_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security:客户端只能读写自己的数据(经 sessions 关联到 auth.uid())。
-- agent 运行时用 service key 读写,自动绕过 RLS(已自行校验 JWT 与归属)。
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sessions          enable row level security;
alter table public.documents          enable row level security;
alter table public.document_versions  enable row level security;
alter table public.messages           enable row level security;

-- sessions:直接 user_id = auth.uid()。
create policy sessions_select on public.sessions
  for select using (user_id = (select auth.uid()));
create policy sessions_insert on public.sessions
  for insert with check (user_id = (select auth.uid()));
create policy sessions_update on public.sessions
  for update using (user_id = (select auth.uid()))
            with check (user_id = (select auth.uid()));
create policy sessions_delete on public.sessions
  for delete using (user_id = (select auth.uid()));

-- documents:经 session_id 关联到 sessions.user_id。
create policy documents_select on public.documents
  for select using (exists (
    select 1 from public.sessions s
    where s.id = documents.session_id and s.user_id = (select auth.uid())
  ));
create policy documents_insert on public.documents
  for insert with check (exists (
    select 1 from public.sessions s
    where s.id = documents.session_id and s.user_id = (select auth.uid())
  ));
create policy documents_update on public.documents
  for update using (exists (
    select 1 from public.sessions s
    where s.id = documents.session_id and s.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.sessions s
    where s.id = documents.session_id and s.user_id = (select auth.uid())
  ));
create policy documents_delete on public.documents
  for delete using (exists (
    select 1 from public.sessions s
    where s.id = documents.session_id and s.user_id = (select auth.uid())
  ));

-- document_versions:经 session_id 关联到 sessions.user_id。
create policy document_versions_select on public.document_versions
  for select using (exists (
    select 1 from public.sessions s
    where s.id = document_versions.session_id and s.user_id = (select auth.uid())
  ));
create policy document_versions_insert on public.document_versions
  for insert with check (exists (
    select 1 from public.sessions s
    where s.id = document_versions.session_id and s.user_id = (select auth.uid())
  ));
create policy document_versions_update on public.document_versions
  for update using (exists (
    select 1 from public.sessions s
    where s.id = document_versions.session_id and s.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.sessions s
    where s.id = document_versions.session_id and s.user_id = (select auth.uid())
  ));
create policy document_versions_delete on public.document_versions
  for delete using (exists (
    select 1 from public.sessions s
    where s.id = document_versions.session_id and s.user_id = (select auth.uid())
  ));

-- messages:经 session_id 关联到 sessions.user_id。
create policy messages_select on public.messages
  for select using (exists (
    select 1 from public.sessions s
    where s.id = messages.session_id and s.user_id = (select auth.uid())
  ));
create policy messages_insert on public.messages
  for insert with check (exists (
    select 1 from public.sessions s
    where s.id = messages.session_id and s.user_id = (select auth.uid())
  ));
create policy messages_update on public.messages
  for update using (exists (
    select 1 from public.sessions s
    where s.id = messages.session_id and s.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.sessions s
    where s.id = messages.session_id and s.user_id = (select auth.uid())
  ));
create policy messages_delete on public.messages
  for delete using (exists (
    select 1 from public.sessions s
    where s.id = messages.session_id and s.user_id = (select auth.uid())
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- save_turn:一轮结束时由 agent 通过 supabase.rpc('save_turn', ...) 原子落库。
--
-- 跨包契约 —— 参数名/顺序/语义必须与 agent 的 src/store.ts 调用完全一致:
--   p_session_id uuid, p_user_text text, p_assistant_text text,
--   p_deltas jsonb, p_options jsonb, p_state jsonb, p_changed boolean
--
-- 行为:
--   1. 若 p_user_text 非空,插入一条 user 消息;
--   2. 插入一条 assistant 消息(text + 本轮 deltas + options);
--   3. 更新 documents.state = p_state、sessions.updated_at = now();
--   4. 若 p_changed 为真,插入一条 document_versions
--      (turn_index = 该会话当前最大 turn_index + 1)。
--
-- security definer:让 agent 经 RPC 即可原子落库;函数内对所属用户的隔离
-- 已由 agent 在调用前校验(service key 路径)。search_path 锁死防注入。
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.save_turn(
  p_session_id      uuid,
  p_user_text       text,
  p_assistant_text  text,
  p_deltas          jsonb,
  p_options         jsonb,
  p_state           jsonb,
  p_changed         boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_turn integer;
begin
  -- 1. user 消息:仅当本轮确有用户文本时写入(点人物卡等也走文本)。
  if p_user_text is not null and length(p_user_text) > 0 then
    insert into public.messages (session_id, role, text)
    values (p_session_id, 'user', p_user_text);
  end if;

  -- 2. assistant 消息:带本轮 deltas 与 options。
  insert into public.messages (session_id, role, text, deltas, options)
  values (p_session_id, 'assistant', p_assistant_text, p_deltas, p_options);

  -- 3. 更新当前权威剧本与会话时间戳。
  update public.documents
     set state = p_state
   where session_id = p_session_id;

  update public.sessions
     set updated_at = now()
   where id = p_session_id;

  -- 4. 仅在本轮剧本真有改动时写一版历史。
  if p_changed then
    select coalesce(max(turn_index), 0) + 1
      into v_next_turn
      from public.document_versions
     where session_id = p_session_id;

    insert into public.document_versions (session_id, turn_index, state)
    values (p_session_id, v_next_turn, p_state);
  end if;
end;
$$;
