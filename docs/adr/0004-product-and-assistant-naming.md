# 产品名「织幕」与 AI 助手角色名「主管编剧」(可自定义),代号 Incipel 不变

产品对用户的品牌名定为**织幕**(暂定),取代旧名「芯」。用户在对话里打交道的 AI 助手,其角色显示名定为**主管编剧**,作为默认值,且**允许用户自定义**。代号 **Incipel** 仍只用于仓库 / 包名(`@incipel/*`)、slug、bundleId,不向用户呈现。

之所以拆成两个名字:旧设计里「芯」一词同时承担了「这个产品叫什么」和「跟我说话的助手叫什么」两重身份。两者其实是不同的东西——产品名是稳定的品牌,助手名是一个角色,日后还要让用户改成自己喜欢的称呼。把它们分开,品牌与角色各自演化,也为「用户自定义助手名」留出干净的接口。

## 具体位置

- 术语基线在 [`CONTEXT.md`](../../CONTEXT.md) 的「名称」小节;本 ADR 是该决策的记录。
- 助手名默认值集中两处:agent 侧 `packages/agent/src/prompt.ts` 的 `DEFAULT_ASSISTANT_NAME`,客户端 `apps/mobile/src/config.ts` 的 `DEFAULT_ASSISTANT_NAME`。
- 自定义助手名已支持:客户端可经 `/run` 的 `forwardedProps.assistantName` 传入,`run.ts` → `buildPrompt({ assistantName })` 把它写进动态 prompt 的「当前助手显示名」段;未传时使用「主管编剧」。Mastra Agent 的静态 instructions 不含助手显示名。

## Consequences

- 助手名只进入每轮动态 prompt,不改变 Mastra Agent 的静态 instructions。更换助手名只改变「当前助手显示名」段和历史里助手发言的标注。
- 持久化暂未做:本 ADR 只立「默认值 + 透传接口」,助手名按会话 / 用户存储是后续工作。在那之前,不传 `assistantName` 即用默认「主管编剧」。
- 历史 ADR(0001–0003)中出现的「芯」属当时记录,**不回改**;命名以本 ADR 与 CONTEXT.md 为准。
- 代号 Incipel 不动:`@incipel/*`、slug `incipel`、bundleId `com.incipel.app` 保持不变,改名不触碰它们。
