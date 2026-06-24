# 模型上下文使用完整对话历史,而非最近 N 条窗口

> Status: accepted · 已实现(`packages/agent`:`store.loadSession` 取全部消息、`buildPrompt` 不再截断)。长会话的规模优化(compact)见 [issue #49](https://github.com/chengdagong/Incipel/issues/49)。与 [PR #48](https://github.com/chengdagong/Incipel/pull/48)(客户端恢复已有会话的历史)同期确立。

## 背景

agent 一轮的模型调用,其对话上下文原先由服务端这样构造:

- 从数据库读该会话**最近 N 条**消息(默认 N=10)作为对话上下文;
- 从客户端 `/run` 请求体里只取**最后一条 user 消息**(`packages/agent/src/app.ts` 的 `lastUserText`),其余 `input.messages` 不参与上下文构造;
- 权威剧本 `documents.state` 从数据库读取。

也就是说,模型每轮只能看到最近约 10 条对话。对一个编剧助手而言,这是错误的:早期的世界观设定、人物决定、被否决的方向等,都是后续创作必须延续的上下文;只给最近 10 条,模型会"忘记"会话前半程,产出与既定设定不一致的内容。

## 决定

- **模型上下文基于会话的完整对话历史,而非固定的最近 N 条窗口。** 已实现:`store.loadSession` 取该会话全部消息(按时间正序),`buildPrompt` 把它们全部拼进 prompt,不再截断(删去原 `recentLimit=10` 与 `RECENT_MESSAGE_LIMIT` 截断;`LoadedSession.recent` 改名为 `history`)。
- **权威剧本 `documents.state` 仍从数据库读取,本决定不改变这一点。**
- **客户端把恢复出的历史放进 `agent.messages`(PR #48)**,与本决定一致。
- **长会话的规模问题由 compact 机制解决,而非退回截断。** 随会话变长,逐字塞入全部历史会增加 token、并最终逼近模型上下文窗口上限。正确的应对是把较早对话**压缩成摘要**(以"摘要 + 近期原文"代表完整历史),而不是重新引入"最近 N 条"的硬截断。compact 的设计与实现见 [issue #49](https://github.com/chengdagong/Incipel/issues/49);它是本决定在长会话下的延伸优化,而非前提——摘要仍代表早期对话,上下文仍覆盖整段会话。

## 后果

- 模型每轮都能看到整段会话,创作连续性不再被"最近 10 条"切断。
- 每轮模型调用的 token 量随会话长度增长;成本上升,并在**极长**会话下可能逼近模型上下文窗口上限。这是已知取舍:在 compact([issue #49](https://github.com/chengdagong/Incipel/issues/49))实现前,极长会话存在触达上限的风险;但对绝大多数会话,"完整历史"是严格优于"最近 10 条"的正确行为。
- 客户端侧把恢复历史放进 `agent.messages` 也会随 `/run` 请求体发送(256KB 上限);其规模约束同样归入 compact([issue #49](https://github.com/chengdagong/Incipel/issues/49))。
