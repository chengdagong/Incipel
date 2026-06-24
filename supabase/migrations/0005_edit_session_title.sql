-- 用户手动编辑会话标题:经受限 RPC 同时更新 sessions.title 与 documents.state.meta.title。
-- 客户端仍不能直接 update documents.state,也不能直接 update sessions.title。

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

revoke execute on function public.update_session_title(uuid, text) from public;
grant  execute on function public.update_session_title(uuid, text) to authenticated;

-- AI 经 set_meta(title) 改剧本标题时,也同步 sessions.title,让列表页不必只依赖
-- documents.state.meta.title 的回退显示。
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
  -- 同一会话的并发 save_turn 在这里按顺序执行,避免 turn_index 重复。
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  -- 同一 run 若已写入数据库,直接返回,不重复插入消息或版本。
  if exists (
    select 1 from public.messages
    where session_id = p_session_id and run_id = p_run_id
  ) then
    return;
  end if;

  if p_user_text is not null and length(p_user_text) > 0 then
    insert into public.messages (session_id, run_id, role, text)
    values (p_session_id, p_run_id, 'user', p_user_text);
  end if;

  insert into public.messages (session_id, run_id, role, text, deltas, options)
  values (p_session_id, p_run_id, 'assistant', p_assistant_text, p_deltas, p_options);

  update public.documents
     set state = p_state
   where session_id = p_session_id;

  update public.sessions
     set title = case
           when p_state #> '{meta,title}' is null then title
           else coalesce(p_state #>> '{meta,title}', '')
         end,
         updated_at = now()
   where id = p_session_id;

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

revoke execute on function
  public.save_turn(uuid, text, text, text, jsonb, jsonb, jsonb, boolean) from public;
grant  execute on function
  public.save_turn(uuid, text, text, text, jsonb, jsonb, jsonb, boolean) to service_role;
