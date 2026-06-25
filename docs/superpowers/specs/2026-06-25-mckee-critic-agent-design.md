# McKee Critic Agent Design

## Goal

新增一个基于麦基方法论的评论 Agent。编剧助手在提出故事大纲或节拍建议后，必须先请求该 Agent 评论，再按评论修订，最后只把修订后的建议返回给用户。

## Scope

- 评论 Agent 只评论故事大纲、幕设计、场景节拍和结构修改建议。
- 评论 Agent 不直接写入剧本，也不调用 screenplay tools。
- 编剧助手仍是唯一面向用户并调用 screenplay tools 的 Agent。
- 本次只接入 Agent runtime 与 prompt 约束，不改移动端界面。

## Behavior

编剧助手遇到故事大纲或节拍建议时，应先形成内部草稿，再调用评论工具，把草稿、当前剧本快照和用户目标交给麦基式评论 Agent。评论 Agent 返回结构化评论：最重要的问题、证据依据、修订建议和风险。编剧助手据此修改草稿，必要时调用 screenplay tools 写入剧本，并在聊天回复中只总结最终版本。

## Testing

- Mastra registry 注册 `mckee-story-critic`，且不挂载 screenplay tools。
- `screenwriter` 与 `studio-screenwriter` 的 instructions 明确要求先请求评论再返回。
- 运行时给 `screenwriter` 与 `studio-screenwriter` 暴露评论工具；`logline` 不暴露。
