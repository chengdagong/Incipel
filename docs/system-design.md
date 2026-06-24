# 编剧助手「织幕」· 系统设计

> 状态:v1 设计基线 · 日期:2026-06-17(经 grill-with-docs 复核细化)
> 来源:基于 Claude Design 导出的高保真原型整理(`编剧助手 原型.dc.html` 及两份对话记录),原型是 HTML/CSS/JS 交互稿,本文是把它生产化的系统设计。
> 术语见 [`CONTEXT.md`](../CONTEXT.md);关键决策见 [`docs/adr/`](./adr/)。

---

## 1. 背景与目标

「织幕」是一个 AI 原生的编剧助手移动应用。核心交互是**一条流式对话**:用户给一个灵感,助手一步步引导推进——灵感 → 世界观 → 人物 → 大纲 → 分场 → 对白。

产品的关键不在聊天本身,而在:**对话过程持续生成并保存一份结构化的剧本。** 剧本(世界观、人物、三幕大纲、分场对白)才是真正的产物,对话是生产和打磨它的手段。这层关系是双向的:

- 对话生成剧本——助手产出的内容以卡片形式内联在聊天里,同时汇入右上「文档」面板;
- 剧本反向触发对话——点一张人物卡,回到对话深聊、修订这个角色。

### 核心架构判断

这个产品真正难的一件事,是**把自由流动的对话可靠地变成增量更新的结构化状态**,同时控制延迟与成本,并跨会话、跨设备保存。

原型在客户端解决了一个很窄的版本,且在迭代中反复栽在同一处:让模型输出 JSON / 文本标记,再由客户端解析——换行、引号、长文本一再撑坏格式,解析失败就把原始内容当回复显示出来。原型最后退到「纯文本分区标记」缓解,但这只是减轻症状。

本设计从机制上换掉这条脆弱的流程:**剧本更新走模型的 tool use(结构化工具调用),由 AG-UI 协议负责序列化与增量传输。** 模型吐什么文本都不再影响结构化数据的正确性——「解析失败」这一整类问题不复存在(见 [ADR-0001](./adr/0001-screenplay-mutation-contract.md))。

---

## 2. 需求

### 2.1 功能需求(来自原型)

| 模块 | 行为 |
|---|---|
| 欢迎页 | 输入任意灵感;🎲 一键由 AI 生成一句 logline 填入;方向建议 chip;「开始创作」进入对话 |
| 流式对话 | 真实模型驱动,打字机式流式回复;可点选项(quick reply)+ 自由输入;回车发送 |
| 内联卡片 | 助手每轮产出新内容时,消息下方内联一张卡片(世界观/人物/大纲/分场对白),只显示本轮新增;底部按钮一键打开文档全文 |
| 引导 / 接管 | 主管编剧每轮自行判断:给可点选项让用户选(引导),还是直接成体系地写出内容(接管);拿不准就问。不是粘住的模式,逐轮判断 |
| 文档面板 | 累积的剧本,随对话实时更新;人物卡可点击回到对话修订(导出移出 v1) |
| 侧栏抽屉 | 新建创作、会话列表、作品列表;收藏(starred)+ 最近(recent)两段 |
| 历史会话 | 全屏会话列表;续写、删除;空状态引导 |
| 作品 | 每个会话对应一部作品(它的剧本);全屏作品列表,点开直接进文档视图 |
| 标题编辑 | 用户可点击对话顶栏标题并手动编辑;同时更新会话标题与剧本标题 |
| 主题 | 可调主色(accent) |

### 2.2 非功能需求

- **流式延迟**:首 token 要快(打字机的即时感是体验核心);剧本增量可略滞后于文本。
- **成本可控**:每个有改动的轮约 1–2 次模型生成(多步,见 §6.2),每次点骰子一次调用,上下文随会话增长——必须主动约束。
- **跨设备**:会话与剧本存云端,换设备能续写(升级账号后)。
- **可靠**:断网或模型出错时给明确的重试,不编造内容。
- **China 市场**:模型访问与合规存在不确定性,需要可切换的模型抽象层。

### 2.3 约束(已定的技术选型)

- 客户端:**React Native / Expo**,UI 用 `@copilotkit/react-native` 的 headless hooks + 自绘组件。
- 协议:**AG-UI**(文本流 + 共享状态),传输走 **SSE**(每轮一个 run)。
- Agent 运行时:**Mastra application + Hono server adapter**,移动端协议仍是 AG-UI SSE(见 [ADR-0011](./adr/0011-mastra-node-agent-runtime.md))。
- 模型:**抽象层可切换**,默认通过 Mastra 接 OpenRouter;**仅在 tool-use 可靠的 provider 间切换**,不接弱模型(见 ADR-0001)。
- 数据:**Supabase**(Auth + Postgres + Storage + Realtime)。

---

## 3. 技术栈决策(一句话理由)

| 选型 | 理由 |
|---|---|
| AG-UI 协议 | 它的共享状态(STATE_SNAPSHOT / STATE_DELTA)正好就是「对话逐步生成剧本」的形态;tool use 走协议,避免原型那类解析 bug |
| RN / Expo + CopilotKit | 唯一能直接复用 CopilotKit headless hooks 的跨平台方案;与 AG-UI 同属 TS 生态,整体协作顺畅 |
| Mastra application + Hono server adapter | 让 tool use、streaming、未来 hook / subagent 机制留在 Mastra application;AG-UI 事件仍由 Incipel 控制 |
| 模型抽象层 | China 访问/合规不确定,把 provider 抽象在 agent 层,客户端无感切换;只切 tool-use 可靠的 provider |
| Supabase 做数据层 | Auth / Postgres / Storage / Realtime 一站齐全;**只做数据层,不承载 agent 运行时** |

---

## 4. 架构总览

分两个层(plane):**数据层**(Supabase)与**计算层**(agent 运行时)。把它们分开是这套架构的要点——不要试图把 agent 塞进 Supabase。

```
┌──────────────────────────────────────────────────────┐
│  RN / Expo 客户端                                       │
│  · 欢迎 / 对话 / 文档面板 / 侧栏 / 历史 / 作品           │
│  · @copilotkit/react-native headless hooks + 自绘 UI    │
│  · 消费 AG-UI 事件:文本流 + 共享状态(剧本)            │
│  · supabase-js:Auth、查询会话/作品列表                  │
└───────▲──────────────────────────────────▲─────────────┘
        │ AG-UI 事件流 (SSE)                │ HTTPS + JWT
        │ TEXT_MESSAGE_* / STATE_* /        │ (查询/变更)
        │ TOOL_CALL_*                       │
┌───────┴───────────────────────────┐      │
│  Agent 运行时 (compute plane)       │      │
│  · 一轮:载入剧本状态 + 完整对话历史 │      │
│    → 模型 tool use                  │      │
│    → 流式回复 + 剧本增量(DELTA)    │      │
│  · 模型抽象层(只切强 provider)     │      │
│  · prompt caching                   │      │
│  · 一次 /logline(便宜模型)         │──────┤ 读写 Postgres / Storage
│  · Mastra app + Hono adapter        │      │ (服务端用 service key)
│    (见 ADR-0011)                  │      │
└───────────────────────────────────┘      │
                                     ┌──────┴──────────────────────┐
                                     │  Supabase (data plane)       │
                                     │  · Auth(含匿名登录)         │
                                     │  · Postgres + RLS:           │
                                     │    sessions / documents /    │
                                     │    document_versions /       │
                                     │    messages                  │
                                     │  · Storage:图片上传          │
                                     │  · Realtime:跨设备同步(可选)│
                                     └──────────────────────────────┘
```

### 组件职责

- **客户端**:渲染;持有 Supabase 会话(JWT);通过 AG-UI 连到 agent 跑对话;直接用 supabase-js 读列表类数据(会话、作品)。不持有任何模型密钥。
- **Agent 运行时**:唯一调用模型的地方;管理一轮的编排、tool use 写入数据库、AG-UI 事件发射;模型抽象层与重试在这一层。校验客户端 JWT,把会话限定在该用户。
- **Supabase**:账号、结构化数据、文件、可选的实时同步。Postgres 开 Row Level Security,按 `user_id` 隔离。

---

## 5. 共享状态:剧本(keystone)

agent 与客户端同步的**唯一权威对象**。相比原型的 `doc`,关键升级是**给世界观小节、人物、幕、场景稳定 id**。

```ts
type Screenplay = {
  meta: {
    title:   string;
    logline: string;
    accent:  string;          // 主色
    updatedAt: string;        // ISO
  };
  world:      WorldSection[];  // 世界观:若干带 id 的小节(标题任意)
  characters: Character[];
  outline:    Act[];
  scenes:     Scene[];         // 扁平,不挂在某一幕下
};

type WorldSection  = { id: string; title: string; text: string };
type CharacterAttr = { id: string; label: string; value: string };  // 外貌/性格/身份…
type Character     = { id: string; name: string; role: string; attrs: CharacterAttr[] };
type Act           = { id: string; act: string;  beat: string };
type Scene         = { id: string; slug: string; content: string };
```

- **每个实体都有稳定 id,由服务端生成**(模型无权自造)。id 让 STATE_DELTA 精确 patch 单个实体而不重发整组,也让「针对某角色 / 某节深入」稳稳命中同一对象。原型里靠名字定位,改名即失联。
- **世界观拆成带 id 的小节**(标题任意):可精确改某一节而不动其余,与人物/幕/场一致。原型里世界观是整段文本、整段覆盖,partial 编辑会丢内容(见 ADR-0001)。
- **人物是结构化的**:名字 + 一句话定位(role)+ 若干带 id 的属性(`attrs`,如 外貌/性格/身份)。`attrId` 全局唯一。这取代早期的单段 `note`,以支持「点某条属性回对话深聊」(聚焦标签)与「由 外貌+性格 拼肖像提示词」;每条属性单独 patch、单独引用(见 ADR-0001 的人物属性扩展段)。
- **scenes 扁平**,不与幕建父子关系:slug(内景/外景 地点 — 时间)即标准场景标题,顺序由对话给出。要「按幕折叠浏览」再 later 加 `actId`。
- **options(可点选项)不进剧本**:它是一轮内的瞬时 UI 状态(见 §7),随下一轮用户输入清空。

---

## 6. AG-UI 事件契约

### 6.1 用到的事件

- 生命周期:`RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`
- 文本流:`TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END`
- 工具:`TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END`
- 状态:`STATE_SNAPSHOT`(连接建立时给出当前剧本基线)/ `STATE_DELTA`(JSON Patch 增量)
- 自定义:`CUSTOM { name: "options", value: string[] }`(本轮的可点选项)

### 6.2 一轮的时序

```
客户端 ──(用户消息 + sessionId + JWT)──▶ Agent
Agent: 载入 documents.state + 完整 messages
Agent: 发 RUN_STARTED;若新连接先发 STATE_SNAPSHOT(当前剧本)
Agent ──▶ 模型(Mastra Agent instructions[cached] + 剧本[cached prefix] + 完整对话历史 + 新消息 + 工具定义)
模型流式产出:
  · 文本 token        → Agent 转发 TEXT_MESSAGE_CONTENT(进气泡,打字机)
  · 工具调用          → Agent 应用到内存中的剧本 → 每处改动发一条 STATE_DELTA(进卡片)
  · propose_options   → Agent 发 CUSTOM options
本轮结束:
  Agent 在一个事务里:更新 documents.state、插入 assistant messages(text + 本轮 deltas + options);
                     若本轮剧本有改动,另写一条 document_versions
  Agent 发 RUN_FINISHED
客户端:文本与卡片在流式过程中已渲染;无需本地持久化(除缓存外)
```

**内联卡片 = 本轮产生的那批 STATE_DELTA。** 这直接替换原型里两个手写函数:`diffCard()`(算这轮新增)由 DELTA 天然给出;`mergeDoc()`(增量并入)就是 DELTA 的应用。

**多步生成(见 [ADR-0003](./adr/0003-multi-step-tool-loop.md)):** 模型这一「轮」在 Mastra agent stream 里可能跑多步——第 1 步发起工具调用(我们就地 apply 并发 STATE_DELTA),工具(ack)执行后 agent 带着结果再生成一步,**这一步才产出给用户的总结文本**(TEXT_MESSAGE_*)。若只跑单步,模型纯接管时可能只完成 tool call、不产任何文本(空回复)。代价:有改动的轮通常约 2 次模型生成。

---

## 7. 模型工具定义(tool use)

模型每轮在流式说话的同时,调用 0..n 次工具改剧本。**新建与修改是两个显式动作**,不用「upsert + 可选 id」的隐式约定:

```
set_meta({ title?, logline? })                设定/更新标题、logline(短字段,整段覆盖)

# 世界观小节 / 人物 / 幕 / 分场:每类都有显式 add / update / remove
add_world_section({ title, text })            新建一节(标题任意),id 由服务端生成
update_world_section({ id, title?, text? })   改某一节;id 受枚举约束
remove_world_section({ id })

add_character({ name, role? })                新建人物(名字 + 一句话定位)
update_character({ id, name?, role? })        改人物的名字 / 定位
remove_character({ id })

# 人物属性:结构化 label/value(外貌/性格/身份…),支持点属性深聊与肖像提示词
add_character_attr({ characterId, label, value })  给某人物加一条属性(characterId 受枚举约束)
update_character_attr({ attrId, label?, value? })  改某条属性(attrId 全局唯一,受枚举约束)
remove_character_attr({ attrId })

add_act({ act, beat })                        新建一幕
update_act({ id, act?, beat? })
remove_act({ id })

add_scene({ slug, content })                  新建一场(对白写成「角色（提示）：台词」)
update_scene({ id, slug?, content? })
remove_scene({ id })

propose_options({ options: string[] })        本轮可点选项(最多 3 个,瞬时,不入剧本)
```

- **id 一律服务端生成**,模型无权自造;`update_*` / `remove_*` 的 `id` 在工具 schema 里被约束为「当前剧本中真实存在的那组 id」的**枚举**,**每轮按当前状态重新生成**——模型在生成时就吐不出不存在的 id。服务端再校验一次,id 不合法即拒绝、绝不静默新建。
- **引导 / 接管由模型每轮判断**:给 `propose_options`(引导)还是直接调内容工具(接管),拿不准就在文本里问。不存 `mode` 字段。
- **承诺即兑现**:回复里说了「我帮你搭好大纲 / 立了人物」,就必须真的调对应工具写出来,不能只在文本里口头承诺。
- **只接 tool-use 可靠的模型**,不保留任何文本解析降级路径。完整契约见 [ADR-0001](./adr/0001-screenplay-mutation-contract.md)。

---

## 8. 数据模型(Postgres)

```
users               -- Supabase Auth 托管(含匿名用户)

sessions
  id            uuid pk
  user_id       uuid  -> auth.users
  title         text
  accent        text
  starred       bool  default false
  created_at    timestamptz
  updated_at    timestamptz

documents          -- 当前权威剧本,与 session 1:1
  session_id    uuid pk -> sessions
  state         jsonb            -- Screenplay 对象

document_versions  -- 每个「有剧本改动」的轮写一版,支持撤销/回退(粗粒度历史)
  id            uuid pk
  session_id    uuid -> sessions
  turn_index    int
  state         jsonb
  created_at    timestamptz

messages
  id            uuid pk
  session_id    uuid -> sessions
  role          text             -- 'user' | 'assistant'
  text          text
  deltas        jsonb            -- 这条 assistant 消息产生的 STATE_DELTA 列表
  options       jsonb            -- 这条消息附带的可点选项
  created_at    timestamptz
```

- **`messages.deltas`** 的作用:续聊旧会话时,历史的内联卡片直接照原样重渲染,不用重算——正好接上原型「resumeSession 恢复完整对话流与卡片」的需求。
- **权威剧本放哪**:`documents.state` 存当前态;`document_versions` **只在该轮剧本真有改动时**写一版做历史(纯提问/引导、没动剧本的轮次不写)。**不**上完整 event sourcing(见 §13 取舍)。
- **RLS**:所有表按 `user_id`(经 `sessions` 关联)隔离;客户端只能读自己的列表与剧本、删除自己的会话、收藏自己的会话,并经 `update_session_title` 修改自己的标题。匿名与正式用户一视同仁。agent 运行时用 service key 读写(已自行校验 JWT 与归属)。

---

## 9. 上下文与成本策略

每轮发完整对话历史(见 ADR-0010),同时把剧本状态作为结构化快照放进动态 prompt,不把剧本内容混在自由文本里重复展开。每轮发送:

1. Mastra Agent instructions(编剧助手的人格 + 输出/工具约束)——注册在 Agent 上,稳定不变;
2. Mastra agent-level skill:`screenwriter` 可按需加载 `screenwriting-master` 的 `SKILL.md` 和 `references/`;`logline` 不加载这个 skill;
3. 动态 prompt 前缀:助手显示名 + 当前剧本状态(序列化为可读文本,含各实体 id)——剧本状态作为 cached prefix,变动小;
4. 完整对话历史 + 本轮新消息。

长会话的 token 量由 compact 机制控制(见 issue #49),不再用固定的最近 N 轮截断。

- **logline 骰子**:走独立的 `/logline` 端点,用更小更便宜的模型,并对单用户限流(rate limit)。
- **监控**:每轮记录 token 用量、延迟、tool-call 成功率、所用 provider、错误;按会话累计成本。

---

## 10. 各屏到后端的映射

| 客户端动作 | 后端 |
|---|---|
| 欢迎页点 🎲 | `POST /logline`(便宜模型,一次性 completion,限流) |
| 「开始创作」 | 建 `sessions` + `documents` 行;建立 AG-UI 连接;发首轮 |
| 发消息 / 点选项 | AG-UI run(见 §6.2);选项点击 = 以用户身份发该选项文本 |
| 点人物卡「聊聊 TA」 | 前端发一条聚焦该角色的消息(带 `character.id`),触发一次 run |
| 打开文档 / 收起 | 纯客户端;数据来自已同步的共享状态 |
| 侧栏/历史/作品列表 | supabase-js 直接查 `sessions` join `documents` |
| 收藏 / 删除 | 收藏 = 客户端列级 update `sessions.starred`(列级授权 + RLS;见 migration 0003);删除 = client delete `sessions` 行(RLS) |
| 点击标题并手动编辑 | 客户端调用 `update_session_title(session_id, title)`,函数内校验归属并同时更新 `sessions.title` 与 `documents.state.meta.title` |
| 续写旧会话 | 查 `messages`(含 deltas/options)+ `documents.state`;打开 AG-UI 连接并以该状态作 STATE_SNAPSHOT |

> 导出(Fountain / PDF)移出 v1,见 §15。

---

## 11. 错误处理与可靠性

- **不编造内容**:删掉原型那个「按阶段生成假剧本」的离线引擎(它是为了断网也能演示)。真实产品里改为:模型调用失败时 agent 重试一次,仍失败发 `RUN_ERROR`,客户端显示「网络异常,重试」。
- **离线**:已同步的作品只读可看,但不能推进(生成必须联网)。
- **幂等**:一轮的数据库写入(document + message,有改动再加 version)放在一个 Postgres 事务;流式中途断开,客户端可凭最近一次 STATE_SNAPSHOT 恢复,重发本轮不产生不一致数据。
- **流式中断**:客户端重连后,agent 以 `documents.state` 重发 STATE_SNAPSHOT 保持一致;未完成的轮视为未发生。
- **撤销**:从 `document_versions` 取上一版写回 `documents.state`,发新的 STATE_SNAPSHOT。

---

## 12. 规模与成本(估算与扩展)

- **延迟**:TTFT 主要取决于模型;prompt caching 把静态 instructions 与剧本前缀的处理成本降下来,首 token 更快。
- **并发**:AG-UI run 是 I/O 密集(大多在等模型),单个轻量主机可扛大量并发 SSE。
- **计算层部署**:agent runtime 是 Mastra application + Hono server adapter(见 [ADR-0011](adr/0011-mastra-node-agent-runtime.md))。它适合长轮 SSE 和多步 tool use;部署目标可以是 Cloud Run / Fly / Railway 等 Node 主机。Supabase 只做数据层。
- **跨设备同步**:v1 打开会话时重新拉取即可;需要实时再上 Supabase Realtime 推 `documents` 变更。
- **成本主因**:每个有改动的轮约 2 次模型生成(多步:工具步 + 总结步)+ 每次骰子一次调用。控制手段:bounded context、prompt caching、骰子用便宜模型 + 限流。

---

## 13. 取舍分析

| 决策 | 取 | 舍 / 风险 | 缓解 |
|---|---|---|---|
| 显式 add/update/remove + 枚举门控(不用 upsert) | 杜绝错误/重复 id 与解析失败 | 工具多、schema 每轮动态生成 | 见 ADR-0001;勿退回 upsert |
| 只接 tool-use 可靠的模型(替代文本解析) | 一套契约、健壮 | 接不了 tool-use 弱的模型 | 抽象层只切强 provider;真要弱模型由其适配器包装成统一 tool-use 接口 |
| 状态存 DB + 每轮(有改动)版本,不上 event sourcing | 简单、可查询、够用 | 没有免费的全量时间旅行/审计/分支 | 一版即支持撤销;真要分支再升级 |
| Mastra application + Hono server adapter | 长轮 streaming、tool use 与未来 hook / subagent 更自然 | 需要单独部署 Node server | Supabase 继续只管数据层;部署目标另选 |
| 暂不引入 LangGraph | TS-only、与 Mastra 同栈 | 缺图编排 | agent 变成多 actor 或显式 workflow 时再评估 |
| AG-UI + CopilotKit RN | 整套 TS 栈不断裂 | RN 包较新,有坑(Hermes polyfill、自接 Markdown 渲染) | 用 headless hooks + 自绘,绕开未成熟的部分 |
| v1 仅 AI 写剧本(不开放手编) | 简单,无并发写冲突 | 用户不能直接编辑 | AG-UI 共享状态让 v1.1 加手编是纯增量 |
| 匿名登录 + 事后可选升级 | 零摩擦入门,保住原型手感 | 升级前卸载重装会丢数据 | 有了值得存的作品再提示升级 ·（认证入场时机已由 [ADR-0005](./adr/0005-auth-entry-in-v1.md) 修订:登录页提前进 v1,匿名退为一次点击) |

---

## 14. 随系统成长要重新审视的点

- **用户直接手编剧本(v1.1)**:人与 AI 并发改同一剧本,可能需要 section 级锁或 CRDT/OT。
- **导出(Fountain / PDF)**:移出 v1,后续再做(PDF 给整部作品全貌,Fountain 给剧本正文供导入专业工具)。
- **event sourcing**:若需要审计、版本分支、精细时间旅行。
- **更强的 workflow framework**:若 agent 长出多 actor、多阶段审批或可恢复 workflow,再评估 LangGraph 等方案。
- **多人协作 / 多端实时同步**:更大的工程,v1 不做。
- **超长会话**:对话历史的摘要/压缩策略。
- **`/run` 的输入大小 / 滥用限制**:目前 `/run` 不限制请求体大小。日后若要加(防滥用或防超大请求),按**请求体字节数**与**本轮用户消息长度**设限,**不要**按 `messages` 条数设限。原因:移动端 `@ag-ui/client` 每轮把累积的整个 `messages` 数组发来(约每轮加 2 条,仅在 `threadId` 变化时清空),而 agent 只取其中最后一条 `role==='user'` 的文本(`lastUserText`,见 `packages/agent/src/app.ts`),真正的 prompt 窗口另从 DB 载入(`loadSession`,最近约 10 条,见 §9)。所以请求里的消息条数与 prompt 窗口、成本无关:按条数封顶会随正常会话变长而误伤——几百轮的长会话即便每条都很短也会被拒——同时对单个超大 payload 又拦不住。
- **更多 provider**:接 tool-use 较弱的模型时,由其适配器把结构化提示包装成统一 tool-use 接口,而不是引入第二套契约。
- **CopilotKit Runtime(方案 A 的后续选项)**:若日后要做 web 端共用同一端点,或用 runtime 的 BuiltInAgent / server-side tools / 中间件 / 多 agent 路由,可把 fetch-native 的 `CopilotRuntime`(`createCopilotRuntimeHandler`)挂到 Supabase Edge(Deno)。注意:`InMemory` / `Sqlite` AgentRunner 在 serverless 上不持久,需自写 **Postgres-backed 的自定义 AgentRunner**;Intelligence 模式不可自托管;Edge 的 CPU/墙钟上限照旧。v1 用方案 B(直连 `@ag-ui/client`),持久化由本项目的 Supabase 层承担,无论将来是否上 runtime 都用得上。

---

## 15. v1 范围与后续

**v1(本设计覆盖)**:匿名账号、单人创作、流式对话 + 剧本生成、内联卡片、引导/接管、文档面板、侧栏/历史/作品、收藏、续写、骰子 logline、模型抽象层、错误重试。

> 修订([ADR-0005](./adr/0005-auth-entry-in-v1.md)):v1 增加一张登录页作入口,接 **Apple Sign-In + 匿名(「先随便逛逛」)**;Google 与邮箱呈现但暂不接。原文「邮箱/第三方推迟到 v1.1」就此部分被取代——Apple 提前进 v1。

**v1.1+**:导出(Fountain / PDF)、剧本直接手编、撤销 UI、多端实时同步、更多 provider 适配。

---

## 16. 假设

- 一会话 ⟷ 一剧本,严格 1:1;同一会话同一时刻只跑一轮;v1 不做多人协作 / 多端实时同步。
- 账号默认匿名:绑定(邮箱 / 第三方)前,数据随设备,卸载重装会丢。绑定入口见 [ADR-0005](./adr/0005-auth-entry-in-v1.md)——v1 起以登录页呈现(Apple + 匿名真接),不再是纯粹的「事后才出现」。
- 只接 tool-use 可靠的模型。
- 移动优先;原型里的手机外壳只是交互稿的装饰,生产是全屏。
- 计算层所在区域能访问到所选模型(Claude 从 China 访问的不确定性,由抽象层化解)。
- v1 规模为数百至数千用户量级,非首日百万。
