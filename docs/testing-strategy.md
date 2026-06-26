# 编剧助手「芯」· 自动化测试方案

> 状态:草案 · 日期:2026-06-18
> 范围:为本仓设计一套自动化测试。术语见 [`CONTEXT.md`](../CONTEXT.md);系统设计见 [`system-design.md`](./system-design.md);契约见 [`docs/adr/`](./adr/)。

---

## 1. 现状判断

本仓是 pnpm monorepo,三层 TypeScript(ESM、`strict`、Node ≥ 20)加一层数据库:

| 层 | 包 | 性质 |
|---|---|---|
| 契约 | `@incipel/shared` | 纯函数:类型、`buildToolSchemas`、`idSetsOf`、`serialize`、`sse`。无 I/O,确定性强 |
| 计算 | `@incipel/agent` | Hono 端点、AG-UI 一轮编排、模型抽象层、JWT 校验、Supabase 写入数据库 |
| 客户端 | `@incipel/mobile` | Expo RN + `@ag-ui/client`,事件到 React state 的映射 |
| 数据 | `supabase/migrations/0001_init.sql` | schema + RLS + `save_turn` RPC + 表/函数授权 |

已有的测试基础设施只有两个手动脚本:`packages/agent/src/dev/smoke-turn.ts` 与 `verify-summary.ts`。它们用真实模型 + `MemoryStore` 跑真实一轮,证明了核心循环的注入接缝(`RunDeps` 的 `provider`/`store`)可用——架构本身可测。但它们:无测试框架、依赖真实 API key、缺 key 即跳过、断言很弱、不进 CI、结果不确定。它们是人工验收脚本,不是回归测试网。

最该被测试钉死的,是 ADR-0001 立下的那组契约不变量(id 门控、服务端生成 id、显式 add/update/remove)和最近两次提交收紧的授权边界(RLS、`save_turn` 仅限 service_role)。这些恰恰是「改一处就可能悄悄破坏隔离」的地方,目前零回归保护。

---

## 2. 测试分层与工具选择

```
        E2E / 真实模型      smoke-turn、verify-summary(改造为定时跑,不进 PR)
      ─────────────────
     集成:HTTP + 编排 + DB   app.fetch 驱动 Hono;runTurnCore + 伪 provider;pgTAP 跑 RLS
   ───────────────────────
  单元:契约 + apply + 纯函数   Vitest,大量、快、确定性(最高性价比)
```

| 范围 | 工具 | 理由 |
|---|---|---|
| TS 单元 / 集成(shared + agent) | Vitest | 原生 ESM+TS、与本仓 `"type":"module"` 和 `moduleResolution: Bundler` 一致;异步生成器与 fake timers 支持好;可直接 import workspace 包源码,几乎零配置。零依赖替代是 `node:test` |
| HTTP 层 | Vitest + `app.fetch(new Request(...))` | Hono 是 fetch-native,无需 supertest;SSE 直接读 Response body 流断言 |
| 数据库(RLS/授权/RPC) | pgTAP(`supabase test db`) | Supabase 上验证 policy、`grant`、`security definer` 行为的标准做法;能以不同角色执行、断言权限 |
| 客户端 RN | 暂缓;若做用 `jest-expo` + Testing Library | Vitest 跑 RN 不顺;v1 范围内性价比低。建议先把事件映射逻辑抽成纯 reducer 再测 |

---

## 3. 分区测试计划

### 3.1 `@incipel/shared` — 契约(单元,目标行/分支覆盖 ≥ 95%)

- `buildToolSchemas`:某类实体为空时不暴露对应 `update_*`/`remove_*`;非空时其 `id` 参数是「恰好当前这组 id」的 `z.enum`——传入不存在的 id 必须 parse 失败,传入存在的 id 成功。
- `idSetsOf`:从剧本正确抽出四类 id 集合。
- `emptyScreenplay`、`optionsEvent`(`CUSTOM`/`name:options` 形状)、`sse`(`data: {json}\n\n` wire 格式)各一例钉死。

### 3.2 `apply.ts` — 系统的心脏(单元,目标 ~100%)

- id 门控:`update_*`/`remove_*` 传不存在的 id → 抛 `ApplyError`,绝不静默新建(逐类实体各一例)。
- 服务端生成 id:`add_*` 产出带正确前缀(`char_`/`world_`/`act_`/`scene_`)的 id,且写进剧本。
- JSON Patch 正确性:`add` → `{op:'add', path:'/world/0', value}`;`update` 只覆盖显式传入的字段;`remove` → 正确下标。
- `updatedAt` 语义:有改动才追加 `/meta/updatedAt`;`set_meta` 不传任何字段 → 空 patch、不动 `updatedAt`;`propose_options` → 空 patch。
- 属性级不变量(高价值):把一轮里若干工具调用产生的 STATE_DELTA 依次应用到初始快照(用任一 RFC 6902 库),结果应等于服务端最终 `state`——即「客户端重放增量 == 服务端最终态」。

### 3.3 `run.ts` `runTurnCore` — 一轮编排(集成,目标分支 ≥ 90%)

接缝已经备好(`{ provider, store }` 可注入),只缺一个确定性的伪 provider(见 §5)。用伪 provider + `MemoryStore` 离线跑,断言:

- 事件顺序:`RUN_STARTED` →(`newConnection` 时)`STATE_SNAPSHOT` → 文本/增量交错 → `options`(仅当本轮有选项)→ `RUN_FINISHED`。
- 文本起止:本轮无文本时,不发 `TEXT_MESSAGE_START`/`END`。
- 写入数据库:`saveTurn` 收到的 `changed` 标志正确;`deltas`/`options`/`assistantText` 与事件一致。
- 错误路径:`loadSession` 抛错 → `RUN_ERROR{code:'LOAD_FAILED'}` 且不调 `saveTurn`;provider 两次都抛 → `MODEL_FAILED`;`saveTurn` 抛错 → `PERSIST_FAILED`。
- 重试不变量(经评审强化,见 [KI-1](./known-issues.md#ki-1-重试循环未按尝试隔离状态与流式输出--high)):仅断言「第二次成功、无 `RUN_ERROR`」**不够**——失败尝试在抛错前已把事件写进 SSE 流、客户端已应用,且 `state`/`textStarted`/`messageId` 跨尝试保留。验收标准改为:
  - 第一次发一次 `add_character` 后抛错、第二次重发同一调用并成功 → 写入数据库后的 `state.characters.length === 1`、无重复 id;
  - 第一次 `add` 后 `remove` 再抛错、第二次对该 id `update` → 不抛 `ApplyError`、整轮成功;
  - 端到端不变量:客户端实收的 `STATE_DELTA` 重放结果 == 写入数据库后的 `messages.deltas` 重放结果 == `documents.state`(三者逐字段相等);客户端实收文本重组 == 写入数据库后的 `assistantText`。

> 这条「重试未按尝试隔离」是评审确认的 High 缺陷(一个原因、四种表现),细节与统一修复见 [KI-1](./known-issues.md)。回归测试与修复应同批进行。

### 3.4 `auth.ts` — 安全边界(单元,目标 ≥ 90%)

用 `jose` 在测试里现签 token:

- `bearerToken`:缺 `Authorization`、scheme 非 `bearer`、空 token → `AuthError`。
- HS256(后备路径):有效 token → 取出 `sub` 作 `userId`;过期、签名错、缺 `sub` → `AuthError`。
- 非对称(JWKS)路径:本地生成 ES256 密钥对,mock `createRemoteJWKSet` 或拦截 JWKS fetch,验证 ES256 验签成功、`alg=none` 被拒。这是线上默认路径,应有覆盖;但 jose 内部的拉取失败/冷却/密钥轮换属框架代码,**不单测**(评审驳回了把「JWKS 优先级」当缺陷的说法,它只是普通覆盖项)。
- issuer / audience(经评审新增,见 [KI-4](./known-issues.md#ki-4-verifyjwt-未校验-issueraudience--low)):当前 `verifyJwt` 不校验 iss/aud。加正反例:正确 iss 且 `aud=authenticated` 的用户 token(匿名与正式皆然)→ 通过;同 secret 签的 **service_role token → 应被拒**;iss 指向别的项目 → 应被拒。**不**按 role 设门——匿名与正式用户一视同仁是产品本意,上一轮「role 门控」的建议据此驳回。

### 3.5 `index.ts` — HTTP 层(集成)

用 `app.fetch(new Request(...))` 直接驱动,校验分支不需要模型(它们在进入 SSE 流之前就返回):

- `DEV_NO_AUTH` 关时,坏/缺 `Authorization` → 401;`AuthError` 与其他错误的状态码区分。
- body 非 JSON → 400;缺 `threadId` → 400;`messages` 里无 user 消息 → 400(覆盖字符串与多模态数组两种 content)。
- `createSessionIfMissing` 抛错 → 500。
- 成功路径:响应头 `Content-Type: text/event-stream`,会话被建出。注意:happy SSE 路径目前无法注入伪 provider(`/run` 写死走默认 provider),需先做 §5 的 `createApp(deps)` 改造,否则只能命中真实模型——建议把 happy 编排放在 §3.3 的 `runTurnCore` 层覆盖。
- `/logline`:鉴权分支 + body 校验 + provider 抛错 → 502。
- 输入大小上限(经评审新增,见 [KI-6](./known-issues.md#ki-6-run-入口无输入大小上限--low)):当前 `/run` 不限制 user 消息长度,`/logline` 反而有 Zod 校验。加边界测试:超大 user 消息(数兆字节)或超长 `messages` 数组 → 返回 400/413 且 provider stub 从未被调用、不写 `messages`;正常大小通过。

### 3.6 `prompt.ts` / `id.ts` / 模型适配器(单元,薄)

- `serializeScreenplay`:各区块计数与 `[id]` 标注;`buildScreenwriterInstructions` 输出静态 Agent instructions,含麦基式评论工具调用要求,并覆盖「不要问、直接写完整故事」这类用户明确授权的请求;`buildMckeeStoryCriticInstructions` 输出评论 Agent instructions;`buildPrompt` 只输出动态 prompt,包含助手显示名、完整对话历史、本轮用户消息,空段被过滤。
- `id.ts`:前缀正确即可,一例足够。
- `makeAiSdkProvider`:喂一个伪 `fullStream`(`text-delta`/`tool-call`/`error` 各类 part),断言翻译成的 `StreamChunk` 正确、`error` part 被抛出;Mastra skill 内部工具调用与 `request_mckee_story_critique` 不应被转成 Incipel 剧本工具调用。适配器工厂只测「缺 key 抛错」。
- `mastra-app.ts`:断言 `screenwriter` 的 Mastra `skills` 配置包含 `screenwriting-master`,并用真实 Mastra skill API 覆盖 `listSkills()` / `getSkill()`;断言 `studio-screenwriter` 暴露 screenplay tools 与 `request_mckee_story_critique`;`mckee-story-critic` 与 `logline` 不应加载该 skill。

### 3.7 数据库 — RLS / 授权 / RPC(pgTAP,按不变量而非行覆盖)

在 `supabase start` 的本地栈上,用 pgTAP:

- RLS 隔离:以用户 A 的身份只能 `select` 自己的 `sessions`/`documents`;读不到用户 B 的行。
- 写入边界:`authenticated` 角色对 `documents`/`messages`/`document_versions` 无任何写权限;只能读 `sessions`/`documents`、删自己的 `sessions`。
- `save_turn` 行为:`p_changed=false` 不写 `document_versions`;`p_changed=true` 写一版且 `turn_index = max+1`;`p_user_text` 为空则不插 user 消息;messages + documents + sessions.updated_at 同时变更(原子性)。
- `save_turn` 授权:`EXECUTE` 已从 `PUBLIC` 收回、仅授予 `service_role`——以 `authenticated` 身份经 RPC 调用应被拒。
- 级联删除:删 `sessions` 行,子表连带清除。
- 幂等(经评审新增,见 [KI-2](./known-issues.md#ki-2-save_turn-无幂等键重发同一轮重复写入数据库--medium)):同一 `runId` 重发同一轮**不应**产生重复的 messages 与 `document_versions`。当前实现无幂等键,此测试会失败,暴露与 §11「重发本轮不产生不一致数据」的偏差。
- 并发(经评审新增,见 [KI-3](./known-issues.md#ki-3-同会话并发-save_turn-竞争-turn_index--medium)):对同一 session 并发两次 `save_turn`(均 `changed=true`)。当前实现下一方撞 `document_versions` 唯一约束、整轮回滚(用以把「原子回滚、没有部分写入」写进测试,并暴露「败方整轮丢失」);修复后断言两轮都成功、`turn_index` 连续。

### 3.8 会话创建路径(`store.ts`,集成)

经评审新增,见 [KI-5](./known-issues.md#ki-5-createsessionifmissing-非原子的两表创建--low)。`createSessionIfMissing` 是「先查后插」且两次 insert(`sessions`、`documents`)无事务包裹,崩在中间会留下「有会话、无剧本」的卡死会话。

- 预置一个有 `sessions` 行、无 `documents` 行的会话,调 `loadSession`:断言它不会每轮永久 `LOAD_FAILED`(修复后能补建或自纠)。
- 对同一新 `threadId` 并发调两次 `createSessionIfMissing`:断言不出未处理的主键冲突 500、恰好一行 session + 一行 document。

---

## 4. 覆盖目标汇总

| 区域 | 测试类型 | 目标 |
|---|---|---|
| `shared` 契约 | 单元 | 行/分支 ≥ 95% |
| `apply.ts` | 单元 | ~100%(逐分支 + 重放属性) |
| `run.ts` 编排 | 集成(伪 provider) | 分支 ≥ 90%,全错误码 + 重试 |
| `auth.ts` | 单元 | ≥ 90% |
| `index.ts` HTTP | 集成(`app.fetch`) | 校验分支全覆盖 ~80% |
| `prompt`/`id`/适配器翻译 | 单元 | 关键路径,薄 |
| 数据库 RLS/授权/RPC | pgTAP | 按上列不变量逐条,非行覆盖 |
| `store.ts` 创建路径 | 集成 | 卡死会话 + 并发首轮(KI-5) |
| mobile 客户端 | 暂缓 | v1 不阻塞;先抽 reducer |

不测:Hono / Mastra / supabase-js / jose 等框架代码(含 jose 的 JWKS 拉取/缓存/轮换);适配器工厂的纯接线;样板。

---

## 5. 需要的可测试性改造(轻量,贴合现有接缝)

1. 确定性伪 ModelProvider(最重要的缺失 fixture):一个按脚本产出 `StreamChunk` 的异步生成器,实现 `ModelProvider` 接口。它解锁 §3.3 全部编排测试与 §3.5 happy 路径,完全离线。
2. `/run` 加注入接缝:把 `index.ts` 改成 `createApp(deps?: { store?; provider? })`,与 `runTurnCore` 的 `RunDeps` 保持一致,让 HTTP happy 路径也能喂伪 provider。缺省仍走真实实现。
3. 抽出客户端事件 reducer:把 `apps/mobile/src/agui/client.ts` 里 AG-UI 事件到 state 的映射逻辑抽成不依赖 React/`@ag-ui/client` 的纯函数,用 Vitest 验证「快照→增量→选项→清空」的状态推进。

---

## 6. CI 编排

| 阶段 | 内容 | 触发 |
|---|---|---|
| 1 | `pnpm -r typecheck`(已有) | 每个 PR |
| 2 | 不需要 secret 的测试:`scripts/dev-ios-target.test.sh`、`tools/incipel-dev/cli.test.mjs`、shared/mobile Vitest、agent Vitest(排除 real AI integration) | 每个 PR |
| 3 | `pnpm --filter @incipel/agent test:real-ai`(`@incipel/agent` real AI integration) | push 到 `main`;必须配置 `OPENROUTER_API_KEY`;缺 key 时测试失败 |
| 4 | pgTAP:`supabase db reset` + `supabase test db` | 每个 PR(独立 job,较慢但作为合并前检查) |
| 5 | smoke / verify-summary(真实模型补充检查) | 定时(nightly)或手动;`test:real-ai` 已由阶段 3 执行 |

建议在根 `package.json` 加 `"test": "pnpm -r test"`,各包加 `vitest` 与 `"test": "vitest run"`。

`pull_request` job 不注入 `OPENROUTER_API_KEY`:PR 分支可以修改测试代码并读取环境变量,因此需要 secret 的真实模型测试只放在 `push` 到 `main` 的 CI job 中。该测试本身仍是无条件测试:一旦运行,缺少 `OPENROUTER_API_KEY` 就失败,不会静默跳过。

---

## 7. 现有覆盖的缺口

- 无测试框架、无 `test` 脚本、无 CI 测试 job。
- 无确定性伪 provider——这是阻挡所有离线编排测试的单点。
- 契约不变量(id 门控、动态 schema、JSON Patch 正确性)零自动化保护。
- RLS / 表授权 / `save_turn` EXECUTE 收回属安全关键且刚被改动,完全无回归测试。
- 客户端事件到 state 的映射未测。
- **评审确认的代码缺陷(详见 [`known-issues.md`](./known-issues.md)),目前无测试暴露**:KI-1 重试未按尝试隔离(High)、KI-2 `save_turn` 无幂等键(Medium)、KI-3 同会话并发竞争 `turn_index`(Medium)、KI-4 缺 iss/aud 校验(Low)、KI-5 `createSessionIfMissing` 非原子创建(Low)、KI-6 `/run` 无输入大小上限(Low)。

---

## 8. 实施顺序(性价比从高到低)

1. 装 Vitest + 写 `shared` 与 `apply.ts` 单元测试(含重放属性)——最便宜、最关键。
2. 写伪 provider,补 `run.ts` 编排与错误码/重试测试;同批修 **KI-1**(重试按尝试隔离)。
3. `auth.ts`(含 **KI-4** iss/aud)+ `index.ts` 校验分支(含 **KI-6** 输入上限);做 `createApp(deps)` 接缝。
4. pgTAP 跑 RLS / 授权 / `save_turn`;补 **KI-2** 幂等与 **KI-3** 并发测试;`store.ts` 创建路径测 **KI-5**。
5. 抽客户端 reducer 并测;把 smoke 脚本接入 nightly。

> 第 2/4 步里的回归测试与对应修复(KI-1、KI-2、KI-3、KI-5)应同批进行:先写会失败的测试钉住期望行为,再改代码使其通过。

---

## 9. 评审修订记录(adversarial review,2026-06-18)

对本方案做了一轮对抗式评审:多个独立 agent 调查代码后,再逐条尝试反驳。结论:

- **确认 9 条**,归入 [`known-issues.md`](./known-issues.md)(KI-1 ~ KI-6,其中 KI-1 含四种表现)。本方案 §3.3 / §3.4 / §3.5 / §3.7 / §3.8 已据此强化验收标准。
- **严重度修正**:原先按 High 提出的「重试事件不一致」「`messages.deltas` 漏记」「`save_turn` 重发」三项,经核查分别定为 High(仅重复实体那一面)、Low(暂无消费方)、Medium(需竞争触发)。
- **驳回 3 条**(均为设计本意,不写断言未实现行为的测试):`document_versions` 只写不读(undo 属 v1.1)、JWKS 路径(代码正确,仅普通覆盖项)、`newConnection:true` 恒真(每轮一条 SSE 连接,与 §6.2 一致)。
- **上一轮自我修正**:「role 门控」与「JWKS 提同级优先级」两条建议被驳回/削弱,见 §3.4。
