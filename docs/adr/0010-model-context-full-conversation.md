# 模型上下文使用完整对话历史,而非最近 N 条窗口

> Status: accepted · 实现待 [issue #49](https://github.com/chengdagong/Incipel/issues/49) 的对话历史 compact 机制。与 [PR #48](https://github.com/chengdagong/Incipel/pull/48)(客户端恢复已有会话的历史)同期确立。

## 背景

agent 一轮的模型调用,其对话上下文当前由服务端这样构造(见 `packages/agent/src/run.ts` 的 `buildPrompt` 与 `packages/agent/src/store.ts` 的 `loadSession`):

- 从数据库读该会话**最近 N 条**消息(`recent`,默认 N=10)作为对话上下文;
- 从客户端 `/run` 请求体里只取**最后一条 user 消息**(`packages/agent/src/app.ts` 的 `lastUserText`),其余 `input.messages` 不参与上下文构造;
- 权威剧本 `documents.state` 从数据库读取。

也就是说,模型每轮只能看到最近约 10 条对话。对一个编剧助手而言,这是错误的:早期的世界观设定、人物决定、被否决的方向等,都是后续创作必须延续的上下文;只给最近 10 条,模型会"忘记"会话前半程,产出与既定设定不一致的内容。

## 决定

- **模型上下文应基于会话的完整对话历史,而非固定的最近 N 条窗口。** 当前的 `recent`=10 是错误的临时限制,应予纠正。
- **完整历史经 compact 机制管理后进入上下文,而非逐字全量塞入。** 随会话变长,把全部历史原样塞进 prompt 会撑爆模型的上下文窗口与 token 预算;因此较早的对话压缩成摘要,以"摘要 + 近期原文"的形式代表完整历史。compact 机制的设计与实现见 [issue #49](https://github.com/chengdagong/Incipel/issues/49);它是"使用完整历史"这一决定的实现方式,而非对它的削减——摘要仍代表早期对话,故上下文仍覆盖整段会话。
- **权威剧本 `documents.state` 仍从数据库读取,本决定不改变这一点。**
- **客户端把恢复出的历史放进 `agent.messages`(PR #48 已实现)**,使客户端的会话表示与本决定一致;待服务端按本决定改造后,这些历史可直接服务于上下文构造。

## 后果

- 服务端 `loadSession` 的 `recent` 窗口与 `buildPrompt` 的上下文拼装,需改造为"完整历史(经 compact)",实现随 [issue #49](https://github.com/chengdagong/Incipel/issues/49)。
- 在 #49 落地前,服务端仍按最近 N=10 构造上下文——这是已知的、待纠正的过渡状态;本 ADR 记录目标,以免该限制被误当成有意设计。
- 完整历史会提高每轮模型调用的 token 量与成本;compact 机制负责把它约束在可控范围。
- 长会话的请求体大小、模型上下文窗口上限等约束,统一由 [issue #49](https://github.com/chengdagong/Incipel/issues/49) 处理。
