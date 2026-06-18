-- pgTAP 回归测试:save_turn 幂等(KI-2)、turn_index 推进与并发串行化(KI-3)、
-- create_session_if_missing 原子创建/幂等/补齐/归属校验(KI-5),以及 EXECUTE 授权边界。
--
-- 跑法:supabase start && supabase test db
-- 说明:本文件需本地 Supabase 栈(含 auth schema 与 service_role/authenticated 角色)。
-- 真正的「同会话并发」竞争需多连接并发驱动,超出单事务 pgTAP 的范围;这里验证
-- 顺序路径下 turn_index 连续(advisory lock 不破坏正常路径)与各项幂等/原子性。

begin;
select plan(13);

-- ── 测试数据 ────────────────────────────────────────────────────────────────
-- 一个 auth.users 用户(sessions.user_id 外键指向它)。字段取本地 Supabase 可接受的最小集。
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        'authenticated', 'authenticated', 'a@test.local', '', now(), now());

-- 空剧本载荷(结构不被函数校验,给最小合法 jsonb 即可)。
\set state '{"meta":{"title":"","logline":"","accent":"#C2724E","updatedAt":"2026-06-18T00:00:00Z"},"world":[],"characters":[],"outline":[],"scenes":[]}'

-- ── KI-5:create_session_if_missing 原子创建 ─────────────────────────────────
select lives_ok(
  $$ select public.create_session_if_missing(
       '22222222-2222-2222-2222-222222222222'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid, '', '#C2724E',
       '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb) $$,
  'create_session_if_missing 首次调用成功');

select is(
  (select count(*)::int from public.sessions where id = '22222222-2222-2222-2222-222222222222'),
  1, '建出恰好 1 行 session');
select is(
  (select count(*)::int from public.documents where session_id = '22222222-2222-2222-2222-222222222222'),
  1, '建出恰好 1 行 document(与 session 1:1)');

-- 幂等:再调一次不新增行。
select lives_ok(
  $$ select public.create_session_if_missing(
       '22222222-2222-2222-2222-222222222222'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid, '', '#C2724E',
       '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb) $$,
  '重复调用幂等(不报错)');
select is(
  (select count(*)::int from public.documents where session_id = '22222222-2222-2222-2222-222222222222'),
  1, '幂等:document 仍为 1 行');

-- 补齐:删掉 document 行(模拟卡死会话),再调一次应把它补回。
delete from public.documents where session_id = '22222222-2222-2222-2222-222222222222';
select public.create_session_if_missing(
  '22222222-2222-2222-2222-222222222222'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid, '', '#C2724E',
  '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb);
select is(
  (select count(*)::int from public.documents where session_id = '22222222-2222-2222-2222-222222222222'),
  1, 'KI-5:缺失的 document 行被补齐');

-- 归属校验:他人调用同一会话应抛错(SQLSTATE P0001 + 指定文案)。
select throws_ok(
  $$ select public.create_session_if_missing(
       '22222222-2222-2222-2222-222222222222'::uuid,
       '99999999-9999-9999-9999-999999999999'::uuid, '', '#C2724E',
       '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb) $$,
  'P0001', '会话已存在且不属于该用户',
  'KI-5:会话已存在且不属于该用户时拒绝');

-- ── KI-2 / KI-3:save_turn 幂等与 turn_index ─────────────────────────────────
-- 第一轮(有改动)。
select public.save_turn(
  '22222222-2222-2222-2222-222222222222'::uuid, 'run-1',
  '用户说', '芯回', '[]'::jsonb, '[]'::jsonb,
  '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb, true);

select is(
  (select count(*)::int from public.messages where session_id = '22222222-2222-2222-2222-222222222222'),
  2, '第一轮:1 条 user + 1 条 assistant');

-- KI-2 幂等:同一 run_id 重发,不新增任何 messages / version。
select public.save_turn(
  '22222222-2222-2222-2222-222222222222'::uuid, 'run-1',
  '用户说', '芯回', '[]'::jsonb, '[]'::jsonb,
  '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb, true);
select is(
  (select count(*)::int from public.messages where session_id = '22222222-2222-2222-2222-222222222222'),
  2, 'KI-2:同 run_id 重发,messages 仍为 2');
select is(
  (select count(*)::int from public.document_versions where session_id = '22222222-2222-2222-2222-222222222222'),
  1, 'KI-2:同 run_id 重发,document_versions 仍为 1');

-- 不同 run_id:正常追加,turn_index 连续推进到 2(KI-3 顺序路径)。
select public.save_turn(
  '22222222-2222-2222-2222-222222222222'::uuid, 'run-2',
  '再说', '再回', '[]'::jsonb, '[]'::jsonb,
  '{"meta":{},"world":[],"characters":[],"outline":[],"scenes":[]}'::jsonb, true);
select is(
  (select max(turn_index)::int from public.document_versions where session_id = '22222222-2222-2222-2222-222222222222'),
  2, 'KI-3:不同 run 的 turn_index 连续推进为 2');

-- ── 授权边界:authenticated 不得执行这两个函数(只有 service_role 可) ─────────
select ok(
  not has_function_privilege('authenticated',
    'public.save_turn(uuid, text, text, text, jsonb, jsonb, jsonb, boolean)', 'execute'),
  'authenticated 不能 execute save_turn');
select ok(
  not has_function_privilege('authenticated',
    'public.create_session_if_missing(uuid, uuid, text, text, jsonb)', 'execute'),
  'authenticated 不能 execute create_session_if_missing');

select * from finish();
rollback;
