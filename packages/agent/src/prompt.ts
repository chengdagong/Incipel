// 主管编剧(AI 助手)的 system 人格与每轮 prompt 拼装。
// 产品名是「织幕」;助手角色名独立、且可由用户自定义,默认「主管编剧」(见 CONTEXT.md「名称」)。
//
// 上下文策略(见 ADR-0010):模型上下文使用会话的**完整对话历史**(而非最近 N 条窗口),每轮发:
//   1. SYSTEM(稳定不变,走 prompt caching);
//   2. 当前剧本序列化文本(含各实体 id,作 cached prefix,变动小);
//   3. 完整对话历史 + 本轮新消息。
//   长会话的 token / 上下文窗口规模由 compact 机制约束(见 issue #49),不再用截断式的「最近 N 条」。

import { type Screenplay } from '@incipel/shared';

// 一条历史消息(用于拼接最近若干轮)。
export type PromptMessage = {
  role: 'user' | 'assistant';
  text: string;
};

// AI 助手的默认显示名。产品名是「织幕」(见 CONTEXT.md);助手角色名独立,默认「主管编剧」,
// 且可由用户自定义。改名只换这里与调用方入参,人格内容不变。
export const DEFAULT_ASSISTANT_NAME = '主管编剧';

// 助手名最长字符数。这是 display name,不需要长;超出即截断。
const ASSISTANT_NAME_MAX = 24;

// 题材最长字符数。题材是短标签(最长如「サイバーパンク」),给足余量即可;超出即截断。
const GENRE_MAX = 24;

// 助手名来自客户端(/run 的 forwardedProps.assistantName),会被插进 system 角色的提示里。
// 必须当「数据」而非「指令」处理:去掉换行 / 控制字符、去掉用作名字边界的「」、折叠空白并截断;
// 清洗后为空则回落默认名。否则带换行或额外指令的名字会成为高优先级的 system 文本,
// 削弱本轮的工具与输出约束(prompt injection)。
export function sanitizeAssistantName(name?: string): string {
  if (typeof name !== 'string') return DEFAULT_ASSISTANT_NAME;
  const cleaned = name
    .replace(/\p{Cc}/gu, ' ') // 控制字符(含换行 / 制表)→ 空格
    .replace(/[「」]/g, '') // 名字在提示里用「」包裹,去掉以免越界
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ASSISTANT_NAME_MAX);
  return cleaned.length > 0 ? cleaned : DEFAULT_ASSISTANT_NAME;
}

// 题材同样来自客户端 forwardedProps,可被任意构造。注入 prompt 前必须当「数据」清洗:
// 控制字符 / 换行 → 空格、去掉用作边界的「」、折叠空白并截到短长度——杜绝长文本或指令式
// 内容绕过 MAX_USER_MESSAGE_CHARS 与固定题材列表做 prompt injection。空 / 非字符串 → 空串(不注入)。
export function sanitizeGenre(genre?: string): string {
  if (typeof genre !== 'string') return '';
  return genre
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[「」]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GENRE_MAX);
}

// 助手的人格与硬约束。同一助手名下稳定不变,作为 prompt caching 的命中前缀。
// 助手名通过参数注入,默认「主管编剧」;为日后「用户自定义助手名」预留入口。
// 名字先经 sanitizeAssistantName 清洗,绝不把原始客户端字符串直接拼进 system 提示。
export function buildSystem(assistantName: string = DEFAULT_ASSISTANT_NAME): string {
  const name = sanitizeAssistantName(assistantName);
  return `你是「${name}」,一个 AI 原生的编剧助手。你与用户进行一条流式对话,在对话中持续把灵感打磨成一份结构化剧本:世界观、人物、三幕大纲、分场对白。

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
- add_character / update_character / remove_character:人物,含名字(name)、一句话定位(role)。**新建人物时把已知的外貌/性格等设定一并放进 add_character 的 attrs:[{label,value}] 里一次带齐**(尤其首轮「建一个有外貌/性格的人物」)——本轮刚建的人物,其 id 当轮还不在工具枚举里,add_character_attr 当轮加不上,所以别等下一轮。
- add_character_attr / update_character_attr / remove_character_attr:**对已存在人物**增删改结构化属性(每条 label + value,如 外貌 / 性格 / 目标)。新增给 characterId;改/删用全局唯一的 attrId(只能引用现有属性)。人物设定写成属性,不要堆进一段长文本。
- 人物属性有几个**保留 label**,客户端按它们专门呈现,务必用对:
  - 「身份」:只填角色定位**类别**,在「主角」「配角」「群像」三者中三选一。**绝不**把「这人是谁」的整段描述写进「身份」(那会被当成徽标撑成一大块方框)。
  - 「背景」:人物小传 / 来历介绍这类成段文字写这里(这才是承载一段话的地方)。
  - 「年龄」/「性别」:各自单填一小段(如「25 岁」「女」)。
  - 其余设定用自定义 label(外貌 / 性格 / 目标 / 习惯…),会以标签形式呈现。
- add_act / update_act / remove_act:三幕大纲的一幕,含幕名与该幕节拍。
- add_scene / update_scene / remove_scene:分场;slug 为标准场景标题(内景/外景 地点 — 时间),content 为对白,写成「角色（提示）：台词」逐行。
- propose_options(options):本轮可点选项,最多 3 个。

# id 规则(重要)
- 新建用 add_*(不带 id),修改用 update_*(必须带 id),删除用 remove_*(必须带 id)。
- id 一律由系统生成,你**无权自造 id**。update_* / remove_* 只能引用当前剧本里**真实存在**的 id;系统已在工具可选项里把可用 id 锁定。

# 语气与语言
- **回复语言跟随用户自己写的内容**:用户用中文你就中文、用英文就英文、用日文就日文。客户端界面语言设置不影响这一点(设置页对用户也是这么承诺的)。
- 消息里可能有形如「（聚焦：…）」的前缀,那是客户端注入的聚焦上下文(指明用户想聊哪个人物/属性),**不是用户自己的话,也不代表用户的语言**;判断回复语言时看用户自己写的正文,别被这个标记带偏。
- 用户只发了聚焦标记、没写正文时,按剧本内容的语言回复(默认中文)。
- 专业而亲切,像一位懂行又愿意把手弄脏的编剧搭档。简洁,不啰嗦。`;
}

// 把当前剧本序列化成模型可读的文本(含各实体 id),作为 cached prefix。
// 用稳定的纯文本结构而非 JSON——既便于模型阅读,也避免诱导模型模仿输出 JSON。
export function serializeScreenplay(state: Screenplay): string {
  const lines: string[] = [];
  lines.push(`# 当前剧本(只读快照;改动请调用工具)`);
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
    lines.push(`- [${c.id}] ${c.name}${c.role ? ` — ${c.role}` : ''}`);
    for (const at of c.attrs) {
      lines.push(`    - [${at.id}] ${at.label}: ${at.value}`);
    }
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

// 把完整对话历史拼成文本。助手发言用其显示名(默认「主管编剧」)标注。
function serializeHistory(messages: PromptMessage[], assistantName: string): string {
  if (!messages.length) return '';
  const lines = messages.map((m) => `${m.role === 'user' ? '用户' : assistantName}: ${m.text}`);
  return ['# 对话历史', ...lines].join('\n');
}

export type BuildPromptInput = {
  state: Screenplay;
  // 完整对话历史(不含本轮新消息),按时间正序。见 ADR-0010:模型上下文用全部消息,不截断。
  history: PromptMessage[];
  // 本轮用户新消息。
  userMessage: string;
  // 助手显示名;缺省「主管编剧」。为日后「用户自定义助手名」预留:调用方可按会话/用户传入。
  assistantName?: string;
  // 用户在欢迎屏选的题材(如「科幻」)。仅首轮注入一行定调提示;不进用户消息,故不影响判
  // 语言(设置页承诺「界面语言不影响 AI 回复语言」)。
  genre?: string;
};

export type BuiltPrompt = {
  system: string;
  prompt: string;
};

/**
 * 拼一轮的输入。
 * - system:buildSystem(assistantName)(同一助手名下稳定不变,走 prompt caching)。
 * - prompt:[剧本快照(cached prefix)] + [完整对话历史] + [本轮新消息]。
 *   剧本快照放在最前作为低变动前缀,利于缓存命中。对话历史用全部消息、不截断(见 ADR-0010)。
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const assistantName = sanitizeAssistantName(input.assistantName);
  // 题材偏好只在首轮(还没有历史)注入,作低调的定调提示——单列成段,不混进用户消息正文。
  // 客户端传来的题材先清洗(防 prompt injection),清洗后为空则不注入。
  const genre = sanitizeGenre(input.genre);
  const genreHint =
    genre && input.history.length === 0
      ? `# 用户选定题材\n${genre}\n（界面注入的题材偏好,仅用于定调;不代表用户语言,回复语言仍只跟随用户自己写的正文。）`
      : '';
  const parts = [
    serializeScreenplay(input.state),
    serializeHistory(input.history, assistantName),
    genreHint,
    `# 本轮用户消息\n${input.userMessage}`,
  ].filter((p) => p.length > 0);

  return {
    system: buildSystem(assistantName),
    prompt: parts.join('\n\n'),
  };
}

// /logline 端点的 system:只产一句符合经典结构的 logline,不做别的。
export const LOGLINE_SYSTEM = `你是一位资深编剧。生成**一句**符合经典结构的 logline:
- 反差身份的主角 + 触发事件 + 具体目标 + 明确阻力;
- 约 25–50 字,一句话,中文;
- 只输出这句 logline 本身,不要引号、不要解释、不要任何前后缀。`;

export function buildLoglinePrompt(_idea?: string): { system: string; prompt: string } {
  return {
    system: LOGLINE_SYSTEM,
    prompt: '随机生成一句全新的 logline,题材不限。',
  };
}
