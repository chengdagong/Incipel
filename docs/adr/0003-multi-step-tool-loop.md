# 模型每轮多步生成:工具调用后再产出总结文本

「织幕」一轮的模型调用走 Vercel AI SDK 的**多步**(multi-step):工具带一个 **ack-only 的 `execute`**(只返回 `{ ok: true }`、不碰剧本),并设 `maxSteps`(v4;v5 为 `stopWhen`)。剧本的实际改动仍在 `run.ts` 消费 `tool-call` 时由 `apply.ts` 完成——`execute` 不应用剧本,它唯一的作用是让 SDK 拿到工具结果后**再生成一步**,而那一步才产出给用户的自然语言总结(`TEXT_MESSAGE_*`)。

之所以这么做:单步时,模型一旦进入「调工具」模式,常常**只发工具调用、不产任何文本**,该步以 `finishReason: "tool-calls"` 结束,聊天里就是一个空的助手气泡。这是 Vercel AI SDK 一个广为人知的行为(见 [vercel/ai#8738](https://github.com/vercel/ai/discussions/8738)、[#3433](https://github.com/vercel/ai/issues/3433)、[loop-control 文档](https://ai-sdk.dev/docs/agents/loop-control));不同模型不一,Claude 常带一句确认、GPT/Gemini 多为空。我们在 Claude Sonnet 4.5 上实测 **0/5** 全为空(prompt 硬约束也搬不动);改多步后,同样 5 个强接管措辞 **5/5 既写了内容又给了简短总结**。

## Consequences

- 有「剧本改动」的轮通常约 **2 次模型生成**(第 1 步工具、第 2 步总结);`maxSteps` 上界设为 8,既容纳模型分几步写内容,又防它一直调工具不收尾(见 [vercel/ai#4126](https://github.com/vercel/ai/issues/4126))。
- **不要**把 apply 挪进 `execute`、也**不要**删掉 `maxSteps`——前者会与 `run.ts` 的应用重复,后者会把「空回复」带回来。
- 被否决的替代:① 纯 prompt 要求每轮说话(实测 0/5 无效);② `say` 工具(单步、更省,但非确定性);③ UI 层回退(用户明确不要)。
