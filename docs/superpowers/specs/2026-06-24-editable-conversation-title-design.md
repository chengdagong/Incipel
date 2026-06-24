# 用户可编辑会话标题设计

## 背景

当前项目有两处标题来源:

- `sessions.title`:历史会话、作品和抽屉列表的会话标题字段。
- `documents.state.meta.title`:剧本状态里的标题,也会在对话顶栏、作品卡和文档面板中显示。

AI 可通过 `set_meta(title)` 写入 `documents.state.meta.title`,但用户没有手动编辑入口。客户端目前只被授予 `sessions.starred` 的列级 `update` 权限,不能直接写 `sessions.title`,也不能写整份 `documents.state`。

## 目标

- 用户可以直接点击标题并手动编辑。
- 用户手动标题与 AI 生成标题使用同一份最终显示结果。
- 历史会话、作品列表、抽屉、对话顶栏和文档面板显示一致。
- 保持现有权限边界:客户端不能直接更新整份剧本 JSON,也不能绕过会话归属校验。

## 非目标

- 不引入作品重命名历史。
- 不把标题编辑写成一条对话消息。
- 不触发模型调用。
- 不改变助手名自定义逻辑。

## 推荐方案

新增一个受限的 Postgres function,暂定名为 `update_session_title(p_session_id uuid, p_title text)`。

函数行为:

1. 使用当前 JWT 的 `auth.uid()` 检查 `sessions.user_id` 是否等于当前用户。
2. 清理标题:去掉首尾空白,最多保留 80 个字符。
3. 更新 `sessions.title`。
4. 更新 `documents.state.meta.title`。
5. 更新 `documents.state.meta.updatedAt` 和 `sessions.updated_at`。

授权:

- 从 `PUBLIC` 收回函数执行权限。
- 只授予 `authenticated` 执行权限。
- 函数内部仍按 `auth.uid()` 检查会话归属。
- 不授予客户端对 `documents.state` 的表级 `update` 权限。

AI 写标题的路径也保持一致:在 `save_turn` 写入 `documents.state` 时,同步把 `sessions.title` 设置为 `p_state.meta.title`。这样 AI 通过 `set_meta(title)` 改标题后,历史会话列表也能直接显示新标题。

## 客户端交互

对话页顶栏标题可点击。点击后:

- 标题变成单行输入框。
- 用户按确认键或输入框失焦时保存。
- 输入为空时显示「无题」,并把标题保存为空字符串。
- 保存中禁止重复提交。
- 保存失败时恢复编辑前标题并显示简单错误。

保存成功后,客户端立即更新本地 `screenplay.meta.title` 与 `screenplay.meta.updatedAt`,避免用户需要重开页面才能看到新标题。历史会话、作品和抽屉下次加载时从数据库读取新值。

历史会话页应改为读取 `documents.state`,显示顺序为:

1. `sessions.title`
2. `documents.state.meta.title`
3. 「无题」

这样旧数据中 `sessions.title` 为空但剧本已有标题时,历史会话页也能显示正确标题。

## 测试

数据库测试:

- `authenticated` 用户可以修改自己的会话标题。
- 修改后 `sessions.title` 与 `documents.state.meta.title` 一起变化。
- 修改后 `sessions.updated_at` 与 `documents.state.meta.updatedAt` 更新。
- 用户不能修改他人的会话标题。
- 客户端仍不能直接更新 `documents.state`。

移动端测试:

- 标题清理函数会去掉首尾空白并限制长度。
- 本地剧本标题更新函数只改 `meta.title` 与 `meta.updatedAt`,保留剧本其他字段。

## 需要修改的文件

- `supabase/migrations/0005_edit_session_title.sql`
- `supabase/tests/rls_test.sql`
- `apps/mobile/src/agui/client.ts`
- `apps/mobile/app/(app)/chat.tsx`
- `apps/mobile/app/(app)/history.tsx`
- `apps/mobile/src/i18n.tsx`
- `supabase/README.md`
- `docs/system-design.md`
