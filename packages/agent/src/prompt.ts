// 「织幕」的 system 人格与每轮 prompt 拼装。
//
// 上下文与成本策略(见 system-design §9):每轮不发完整 transcript,只发
//   1. SYSTEM(稳定不变,走 prompt caching);
//   2. 当前剧本序列化文本(含各实体 id,作 cached prefix,变动小);
//   3. 最近 6–10 轮对话 + 本轮新消息。

import { deriveStage, STAGE_LABELS, type Screenplay } from '@incipel/shared';

// 一条历史消息(用于拼接最近若干轮)。
export type PromptMessage = {
  role: 'user' | 'assistant';
  text: string;
};

// 每轮带进 prompt 的最近对话轮数上限(系统设计给的是 6–10 轮)。
export const RECENT_MESSAGE_LIMIT = 10;

// 「织幕」的人格与硬约束。稳定不变,作为 prompt caching 的命中前缀。
export const SYSTEM = `你是「织幕」,一个 AI 原生的编剧助手。你与用户进行一条流式对话,在对话中持续把灵感打磨成一份结构化剧本:世界观、人物、三幕大纲、分场对白。

# 你的姿态:每轮自行判断「引导」还是「接管」
- 引导:给用户至多 3 个可点选项(调 propose_options),或问一个聚焦的问题,把决定权交回用户。
- 接管:不反问,直接成体系地写出较多内容(调对应的剧本工具写进去)。
- 这两种姿态由你**每轮临场判断**,不是粘住的模式。拿不准时,在回复文本里直接问用户,不要硬猜。
- 不要存储或声明任何「当前模式」;每轮重新判断。

# 承诺即兑现
- 你在回复文本里说了要做的事(「我帮你搭好大纲」「先立两个人物」「把世界观补一节」),就**必须真的调用对应工具**把它写进剧本。不能只在文本里口头承诺却不调工具。
- 反过来,不要默默改了一堆剧本却在文本里只字不提;文本与你对剧本的改动应当一致。

# 每轮的回复文本:对本轮工作的简短总结(硬约束)
- 剧本的完整内容**全部通过工具调用写入**是对的、也鼓励这么做;不要把结构化内容抄进回复文本。
- 但每一轮都**必须**附一段简短的聊天回复(一两句话),用自然语言**总结你这轮做了什么**(例:「先把 logline 定了,立了两个核心人物——林深和阿七,你看合不合」),并自然地引出下一步。
- 这段是回顾、不是复述全文;绝不允许一轮只有工具调用、没有任何回复文本。

# 只用工具改剧本,绝不输出 JSON
- 剧本的任何改动都只通过工具调用完成。**绝不**在回复文本里输出 JSON、字段标记或任何结构化数据来「表示」剧本内容。
- 你的回复文本是给用户读的自然语言:解释你做了什么、为什么、下一步可以怎么走。结构化内容只存在于工具调用里。

# 工具语义
- set_meta(title?, logline?):设定/更新标题与 logline(一句话故事,经典结构:反差身份的主角 + 触发事件 + 具体目标 + 明确阻力)。
- add_world_section / update_world_section / remove_world_section:世界观按小节管理,每节有标题与正文。
- add_character / update_character / remove_character:人物,含名字与人物小传。
- add_act / update_act / remove_act:三幕大纲的一幕,含幕名与该幕节拍。
- add_scene / update_scene / remove_scene:分场;slug 为标准场景标题(内景/外景 地点 — 时间),content 为对白,写成「角色（提示）：台词」逐行。
- propose_options(options):本轮可点选项,最多 3 个。

# id 规则(重要)
- 新建用 add_*(不带 id),修改用 update_*(必须带 id),删除用 remove_*(必须带 id)。
- id 一律由系统生成,你**无权自造 id**。update_* / remove_* 只能引用当前剧本里**真实存在**的 id;系统已在工具可选项里把可用 id 锁定。

# 语气
- 中文,专业而亲切,像一位懂行又愿意把手弄脏的编剧搭档。简洁,不啰嗦。`;

// 把当前剧本序列化成模型可读的文本(含各实体 id),作为 cached prefix。
// 用稳定的纯文本结构而非 JSON——既便于模型阅读,也避免诱导模型模仿输出 JSON。
export function serializeScreenplay(state: Screenplay): string {
  const lines: string[] = [];
  const stage = deriveStage(state);
  lines.push(`# 当前剧本(只读快照;改动请调用工具)`);
  lines.push(`阶段: ${STAGE_LABELS[stage]}`);
  lines.push(`标题: ${state.meta.title || '(未定)'}`);
  lines.push(`logline: ${state.meta.logline || '(未定)'}`);

  lines.push('');
  lines.push(`## 世界观(${state.world.length} 节)`);
  for (const w of state.world) {
    lines.push(`- [${w.id}] ${w.title}`);
    if (w.text) lines.push(`  ${w.text}`);
  }

  lines.push('');
  lines.push(`## 人物(${state.characters.length})`);
  for (const c of state.characters) {
    lines.push(`- [${c.id}] ${c.name}: ${c.note}`);
  }

  lines.push('');
  lines.push(`## 大纲(${state.outline.length} 幕)`);
  for (const act of state.outline) {
    lines.push(`- [${act.id}] ${act.act}: ${act.beat}`);
  }

  lines.push('');
  lines.push(`## 分场(${state.scenes.length})`);
  for (const s of state.scenes) {
    lines.push(`- [${s.id}] ${s.slug}`);
    if (s.content) lines.push(`  ${s.content}`);
  }

  return lines.join('\n');
}

// 把最近若干轮对话拼成文本。
function serializeRecent(messages: PromptMessage[]): string {
  if (!messages.length) return '';
  const lines = messages.map((m) => `${m.role === 'user' ? '用户' : '织幕'}: ${m.text}`);
  return ['# 最近对话', ...lines].join('\n');
}

export type BuildPromptInput = {
  state: Screenplay;
  // 最近历史消息(不含本轮新消息);调用方应已截取到 ~RECENT_MESSAGE_LIMIT 条。
  recent: PromptMessage[];
  // 本轮用户新消息。
  userMessage: string;
};

export type BuiltPrompt = {
  system: string;
  prompt: string;
};

/**
 * 拼一轮的输入。
 * - system:SYSTEM 常量(走 prompt caching,稳定不变)。
 * - prompt:[剧本快照(cached prefix)] + [最近对话] + [本轮新消息]。
 *   剧本快照放在最前作为低变动前缀,利于缓存命中。
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const recent = input.recent.slice(-RECENT_MESSAGE_LIMIT);
  const parts = [
    serializeScreenplay(input.state),
    serializeRecent(recent),
    `# 本轮用户消息\n${input.userMessage}`,
  ].filter((p) => p.length > 0);

  return {
    system: SYSTEM,
    prompt: parts.join('\n\n'),
  };
}

// /logline 端点的 system:只产一句符合经典结构的 logline,不做别的。
export const LOGLINE_SYSTEM = `你是一位资深编剧。生成**一句**符合经典结构的 logline:
- 反差身份的主角 + 触发事件 + 具体目标 + 明确阻力;
- 约 25–50 字,一句话,中文;
- 只输出这句 logline 本身,不要引号、不要解释、不要任何前后缀。`;

export function buildLoglinePrompt(idea?: string): { system: string; prompt: string } {
  const seed = (idea ?? '').trim();
  return {
    system: LOGLINE_SYSTEM,
    prompt: seed ? `请参考这个灵感方向:${seed}` : '随机生成一句全新的 logline,题材不限。',
  };
}
