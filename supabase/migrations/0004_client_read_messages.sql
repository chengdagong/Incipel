-- 让客户端能直读自己会话的历史消息,用于「打开已有会话」时恢复对话与世界观显示。
--
-- 背景:0001 只给 authenticated 授了 sessions / documents 的 SELECT(history 列表、works 内嵌
-- 读 documents.state);messages 仅 service_role(agent)可读。客户端打开一条已有会话时需要把历史
-- 对话恢复到界面上,但此前没有任何路径把历史 messages 交给客户端展示——agent 的 /run 只流式当前
-- 一轮,补发的 STATE_SNAPSHOT 也只带权威剧本、不回放消息。结果从历史点开会话后,对话与已生成的
-- 世界观一片空白(数据其实都在数据库里)。
--
-- messages 早已有 owner-only 的 SELECT RLS 策略(messages_select,见 0001):
--   using (exists (select 1 from sessions s where s.id = messages.session_id and s.user_id = auth.uid()))
-- 但缺表级授权时该策略无从生效——权限在表级即被拒(permission denied for table messages)。这里补上
-- 表级 SELECT 授权;行级仍由 messages_select 限定到 auth.uid() 自己的会话,只能读自己的消息、读不到
-- 他人。仍不授予任何写权限:消息一律经 agent 的 save_turn 以 service_role 身份写入。

grant select on table public.messages to authenticated;
