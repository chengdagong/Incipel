# AI 生成长正文自动分段设计

## 背景

AI 编剧助手把成段的长正文写进几个字段:三幕大纲的节拍(`outline[].beat`)、世界观小节正文(`world[].text`)、人物「背景」小传(`character.attrs[].value`,label 为「背景」)。这些内容由模型经工具调用写入,存进 `documents.state`。

模型当前的固定 instructions(`buildScreenwriterInstructions`,在 `packages/agent/src/prompt.ts`)没有任何关于段落的要求,工具 schema 也只是 `beat: z.string()`(`packages/shared/src/tools.ts`),`apply.ts` 原样存储。结果模型常把一整幕写成不分行的一大块。

客户端这边,节拍经 `splitBeat`(`apps/mobile/src/charView.ts`)按换行切段、段间留间距;世界观正文(`apps/mobile/src/components/DocPanel.tsx` 第 186 行)与人物背景(同文件第 392 行)各以单个 `<Text>` 渲染,原样保留文本里的换行。也就是说:**只要模型在长正文里放入段落换行,三处都能正常分段显示,客户端无需改动**;问题在于模型没有放换行。

## 目标

- 模型生成节拍正文、世界观小节正文、人物背景小传时,内容较长的会分自然段,段间有换行。
- 一处 instructions 改动覆盖这三个字段,客户端不改。
- 模型每轮读到的剧本快照(`serializeScreenplay`)在这些字段带换行后仍然整齐,续行不顶格。

## 非目标

- 不改渲染层(`splitBeat` 及 `DocPanel`)。已确认在生成层解决。
- 不修复已经生成的旧内容。这是「仅生成层」的固有结果;要改旧内容,让助手重写对应段落。
- 不改工具 schema,不在 `apply.ts` 里对模型输出做后处理(不自动插入或改写换行)。
- 不动分场对白格式(`scene.content` 仍逐行写「角色（提示）：台词」)。

## 推荐方案

两项改动都在生成层,集中在 `packages/agent/src/prompt.ts`。

### 1. instructions 增加「长正文要分段」一节

在 `buildScreenwriterInstructions` 返回的文本里,「# 工具语义」一节之后、「# id 规则(重要)」之前,新增一节:

```
# 长正文要分段
- 节拍正文、世界观小节正文、人物「背景」小传这类成段的长文,内容较长时要分自然段:按意群拆成若干段,段与段之间空一行;不要把整段写成不分行的一大块。
- 分场对白不在此列——它本来就逐行写「角色（提示）：台词」。
```

要点:

- 用「空一行」(段间一个空行)做段落分隔。对节拍,`splitBeat` 按 `\n` 切分并丢弃空行,空一行得到干净分段;对世界观正文与人物背景,空行在单个 `<Text>` 里显示为段间空隙。两种渲染都成立。
- 限定「内容较长时」,短节拍不会被强行拆段。
- 明确排除分场对白,避免模型给逐行台词乱加空行。

### 2. serializeScreenplay 续行缩进

`serializeScreenplay` 把剧本拼成给模型读的快照。节拍接在 `- [id] 幕名: ` 后、人物属性值接在 `label: ` 后、世界观正文与分场对白各在自己的缩进行内。这些值一旦带换行,join 之后续行会落到第 0 列(顶格),和下一条 `- [id]` 同列,看起来像顶层内容(分场对白的 `content` 现在就已逐行写,已有此问题)。

新增一个续行缩进工具,首行不动、续行加固定缩进、空行保持空:

```ts
function indentContinuation(value: string, indent: string): string {
  return value
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : indent + line))
    .join('\n');
}
```

套用到四个带值字段:

- 世界观正文 `w.text`:缩进两个空格(与其所在行的两空格起首一致)。
- 分场对白 `s.content`:缩进两个空格。
- 大纲节拍 `act.beat`:缩进两个空格(续行落在 `- [id]` 列表项之下)。
- 人物属性值 `at.value`:缩进六个空格(落在四空格缩进的 `- [attr_id]` 之下)。

单行值经此函数原样返回,现有快照格式不变。

## 测试

沿用 `packages/agent/test/prompt.test.ts` 的 `toContain` 写法。

`buildScreenwriterInstructions`:

- 断言含「分自然段」与「段与段之间空一行」。
- 断言含排除分场对白的说明(如「分场对白不在此列」)。

`serializeScreenplay`:

- 现有单行值用例继续通过,格式不变。
- 多行节拍:`beat = '第一段。\n\n第二段。'` 时,快照含 `- [act_a] 第一幕: 第一段。`,且含 `\n  第二段。`(续行两空格缩进),不含顶格的 `\n第二段。`。
- 多行人物背景:`value` 带换行时续行有六空格缩进。

端到端「模型确实分段了」依赖模型,无法单测;改完手动生成一幕节拍,确认 app 内分段显示正常。

## 需要修改的文件

- `packages/agent/src/prompt.ts`(加 instructions 一节;加 `indentContinuation` 并套用到四个字段)
- `packages/agent/test/prompt.test.ts`(新增断言与多行序列化用例)
