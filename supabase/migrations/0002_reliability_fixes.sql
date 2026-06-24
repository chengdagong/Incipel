-- 「芯」(Incipel)可靠性修复:写入数据库幂等 + 同会话并发串行化 + 会话原子创建。
-- 对应 docs/known-issues.md 的 KI-2 / KI-3 / KI-5。本迁移是对 0001_init.sql 的增量更改。
--
-- 跨包契约变更:save_turn 增参 p_run_id(放在 p_session_id 之后),agent 的 src/store.ts
-- 已同步;旧的 7 参版本在此 DROP。create_session_if_missing 为新增 RPC,替代客户端侧的
-- 「先查后插两张表」。

-- ─────────────────────────────────────────────────────────────────────────────
-- KI-2:messages 增 run_id 作幂等键。客户端无写权限,run_id 一律由 agent 经 save_turn 写入。
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.messages add column if not exists run_id text;

-- save_turn 用 (session_id, run_id) 判断本轮是否已写入数据库;也便于按 run 排查。
create index if not exists messages_session_run_idx on public.messages (session_id, run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 重建 save_turn:新增 p_run_id;会话级 advisory lock 串行化 turn_index 计算(KI-3);
-- 以「本 run 是否已有消息」做幂等早返回(KI-2)。其余行为与 0001 一致。
-- 旧 7 参版本先 DROP(签名变了,create or replace 只会新增重载而非替换)。
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.save_turn(uuid, text, text, jsonb, jsonb, jsonb, boolean);

create or replace function public.save_turn(
  p_session_id      uuid,
  p_run_id          text,
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
  -- KI-3:会话级事务 advisory lock。同一会话的并发 save_turn 在此串行,turn_index 不再竞争;
  -- 锁随本函数(单事务)结束自动释放。hashtext 把 uuid 文本映射成 lock key。
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  -- KI-2:本 run 若已写入数据库(存在带该 run_id 的消息),直接返回,不重复插 messages / version。
  -- 与上面的 advisory lock 配合:同一 run 的并发重发也会被串行后命中此早返回。
  if exists (
    select 1 from public.messages
    where session_id = p_session_id and run_id = p_run_id
  ) then
    return;
  end if;

  -- 1. user 消息:仅当本轮确有用户文本时写入(点人物卡等也走文本)。
  if p_user_text is not null and length(p_user_text) > 0 then
    insert into public.messages (session_id, run_id, role, text)
    values (p_session_id, p_run_id, 'user', p_user_text);
  end if;

  -- 2. assistant 消息:带本轮 deltas 与 options。
  insert into public.messages (session_id, run_id, role, text, deltas, options)
  values (p_session_id, p_run_id, 'assistant', p_assistant_text, p_deltas, p_options);

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

-- EXECUTE 授权(同 0001 的边界):从 PUBLIC 收回,仅授予 agent(service_role)。
revoke execute on function
  public.save_turn(uuid, text, text, text, jsonb, jsonb, jsonb, boolean) from public;
grant  execute on function
  public.save_turn(uuid, text, text, text, jsonb, jsonb, jsonb, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- KI-5:原子创建会话 + 剧本。替代 store.ts 里「先查后插两张表」的非原子写法,杜绝
-- 「建了会话、没建剧本」的卡死会话;并发首轮也幂等(ON CONFLICT DO NOTHING,不再 500)。
-- 兼带补齐:会话已存在但 documents 行缺失时,这次会把它补上。
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_session_if_missing(
  p_session_id uuid,
  p_user_id    uuid,
  p_title      text,
  p_accent     text,
  p_state      jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- 建会话行;已存在则不动。
  insert into public.sessions (id, user_id, title, accent)
  values (p_session_id, p_user_id, p_title, p_accent)
  on conflict (id) do nothing;

  -- 归属校验:会话已存在且不属于该用户即拒绝(与 0001 的隔离边界一致)。
  select user_id into v_owner from public.sessions where id = p_session_id;
  if v_owner is distinct from p_user_id then
    raise exception '会话已存在且不属于该用户';
  end if;

  -- 建与之 1:1 的剧本行;已存在则不动(也据此补齐缺失的剧本行)。
  insert into public.documents (session_id, state)
  values (p_session_id, p_state)
  on conflict (session_id) do nothing;
end;
$$;

revoke execute on function
  public.create_session_if_missing(uuid, uuid, text, text, jsonb) from public;
grant  execute on function
  public.create_session_if_missing(uuid, uuid, text, text, jsonb) to service_role;
