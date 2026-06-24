-- 「织幕」收藏功能:放开客户端对 sessions.starred 的「列级」update 授权。
-- 对应抽屉/历史/作品里的星标开关(system-design §10「收藏 / 删除」)。本迁移是对 0001_init.sql 的增量更改。
--
-- 背景:0001_init.sql 给 authenticated(含匿名登录)只授了 sessions 的 select + delete,漏了 update;
-- 而 §10 的设计是「收藏直接 update sessions 行」。于是客户端
--   supabase.from('sessions').update({ starred })
-- 因表级缺 update 授权被拒(permission denied for table sessions),星标乐观更新后必回滚、收藏永不写入数据库。
--
-- 修法:只放开 starred 这一列的 update(列级授权)。其余列客户端仍不可写——
-- documents / messages / document_versions 以及 sessions 的 title / accent / updated_at 等,
-- 一律仍经 agent(service_role)写,维持「agent 是权威数据唯一写入方」的边界(见 0001 授权说明与 §4)。
-- 行级仍由 0001 的 sessions_update 策略限定到 auth.uid()(只能改自己的行)。
-- 不授 updated_at 写权 → 「收藏」不改 updated_at,不影响「最近」按更新时间的排序。

grant update (starred) on table public.sessions to authenticated;
