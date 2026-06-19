-- pgTAP:RLS 隔离、客户端写入边界、级联删除,以及 save_turn 的 changed/空 user 文本行为(§3.7)。
-- save_turn 幂等/turn_index/create_session/EXECUTE 授权见 reliability_test.sql。
-- 跑法:supabase start && supabase db reset && supabase test db

begin;
select plan(13);

-- ── 测试数据:两个用户 A / B,各一会话 + 剧本 ──────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@test.local', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b@test.local', '', now(), now());

insert into public.sessions (id, user_id, title, accent) values
  ('11111111-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'A 的会话', '#C2724E'),
  ('22222222-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'B 的会话', '#C2724E');
insert into public.documents (session_id, state) values
  ('11111111-0000-0000-0000-0000000000a1', '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb),
  ('22222222-0000-0000-0000-0000000000b1', '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb);

-- ── RLS 隔离:以用户 A 身份(authenticated + jwt.claims.sub=A)──────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-0000-0000-000000000001')::text, true);
set local role authenticated;

select is((select count(*)::int from public.sessions  where id = '11111111-0000-0000-0000-0000000000a1'), 1, 'A 能看到自己的会话');
select is((select count(*)::int from public.sessions  where id = '22222222-0000-0000-0000-0000000000b1'), 0, 'A 看不到 B 的会话(RLS)');
select is((select count(*)::int from public.documents where session_id = '11111111-0000-0000-0000-0000000000a1'), 1, 'A 能看到自己的剧本');
select is((select count(*)::int from public.documents where session_id = '22222222-0000-0000-0000-0000000000b1'), 0, 'A 看不到 B 的剧本(RLS)');

-- ── 写入边界:authenticated 对 documents/messages/document_versions 无任何写权 ──
select throws_ok(
  $$ insert into public.messages (session_id, role, text) values ('11111111-0000-0000-0000-0000000000a1', 'user', 'x') $$,
  '42501', null, 'authenticated 不能 insert messages');
select throws_ok(
  $$ update public.documents set state = '{}'::jsonb where session_id = '11111111-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'authenticated 不能 update documents');
select throws_ok(
  $$ insert into public.document_versions (session_id, turn_index, state) values ('11111111-0000-0000-0000-0000000000a1', 1, '{}'::jsonb) $$,
  '42501', null, 'authenticated 不能 insert document_versions');

-- 客户端可删自己的会话;删他人会话被 RLS 过滤(0 行、不报错)。
select lives_ok(
  $$ delete from public.sessions where id = '22222222-0000-0000-0000-0000000000b1' $$,
  'A 删 B 的会话不报错(被 RLS 过滤为 0 行)');

reset role;
select is((select count(*)::int from public.sessions where id = '22222222-0000-0000-0000-0000000000b1'), 1, 'B 的会话未被 A 删掉');

-- ── save_turn 行为:changed / 空 user 文本(以属主身份调用)──────────────────
select public.save_turn('11111111-0000-0000-0000-0000000000a1', 'rl-1', '用户', '芯', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, false);
select is((select count(*)::int from public.document_versions where session_id = '11111111-0000-0000-0000-0000000000a1'), 0, 'changed=false 不写 document_versions');

select public.save_turn('11111111-0000-0000-0000-0000000000a1', 'rl-2', '', '芯回', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, false);
select is((select count(*)::int from public.messages where session_id = '11111111-0000-0000-0000-0000000000a1' and role = 'user'), 1, 'p_user_text 为空时不插 user 消息(只有 rl-1 那条)');
select is((select count(*)::int from public.messages where session_id = '11111111-0000-0000-0000-0000000000a1' and role = 'assistant'), 2, '每轮各插一条 assistant 消息');

-- ── 级联删除:删会话连带清空子表 ──────────────────────────────────────────────
delete from public.sessions where id = '11111111-0000-0000-0000-0000000000a1';
select is(
  (select count(*)::int from public.documents where session_id = '11111111-0000-0000-0000-0000000000a1')
  + (select count(*)::int from public.messages where session_id = '11111111-0000-0000-0000-0000000000a1'),
  0, '删会话级联清空 documents 与 messages');

select * from finish();
rollback;
