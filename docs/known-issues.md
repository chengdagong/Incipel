# 编剧助手「芯」· 已知问题与修复项

> 状态:草案 · 日期:2026-06-18
> 来源:对 [`docs/testing-strategy.md`](./testing-strategy.md) 做对抗式评审(adversarial review)。多个独立 agent 调查代码,再逐条尝试反驳(refute),最终确认 9 条、驳回 3 条。本文档只记录**确认为真**的问题,作为独立修复项。
> 这里只描述问题与修复选项,不含产品代码改动。严重度是经对抗验证修正后的定级。每条附「应加的回归测试」,与测试方案对应。

## 概览

| 编号 | 标题 | 严重度 | 主要位置 |
|---|---|---|---|
| KI-1 | 重试循环未按尝试隔离状态与流式输出 | High | `packages/agent/src/run.ts` |
| KI-2 | `save_turn` 无幂等键,重发同一轮重复落库 | Medium | `supabase/migrations/0001_init.sql` + `store.ts` |
| KI-3 | 同会话并发 `save_turn` 竞争 `turn_index` | Medium | `0001_init.sql` + `index.ts` |
| KI-4 | `verifyJwt` 未校验 issuer/audience | Low | `packages/agent/src/auth.ts` |
| KI-5 | `createSessionIfMissing` 非原子的两表创建 | Low | `packages/agent/src/store.ts` |
| KI-6 | `/run` 入口无输入大小上限 | Low | `packages/agent/src/index.ts` |

被驳回的三项见文末「附:经核查不予立项」。

## 修复状态(本分支)

六项均已修复。以下为修复位置与对应回归测试:

| 编号 | 修复位置 | 回归测试 | 验证 |
|---|---|---|---|
| KI-1 | `run.ts` 重试按尝试克隆 state、整轮单一 messageId、失败补发干净 STATE_SNAPSHOT | `packages/agent/test/run-retry.test.ts`(含失败-重试-已吐文本场景) | 已跑通(Vitest) |
| KI-2 | `0002` save_turn 增 `p_run_id` 幂等早返回;`run.ts`/`store.ts`/`MemoryStore` 透传 runId;**`client.ts` 重试经 `retry()` 复用同一 runId** | `save-turn-idempotency.test.ts`(store 层)+ `reliability_test.sql`(DB 层) | store/DB 已跑通;客户端 retry 仅类型校验 |
| KI-3 | `0002` save_turn 取会话级 `pg_advisory_xact_lock` 串行化 turn_index | `reliability_test.sql`(顺序路径) | pgTAP 已跑通 |
| KI-4 | `auth.ts` 给两处 `jwtVerify` 传 issuer/audience | `packages/agent/test/auth.test.ts` | 已跑通(Vitest)+ 真实 GoTrue 匿名 token 核验 iss/aud |
| KI-5 | `0002` 新增 `create_session_if_missing` 原子 RPC;`store.ts` 改调它,`loadSession` 用 `maybeSingle` 容忍缺失 | `reliability_test.sql`(原子/幂等/补齐/归属) | pgTAP 已跑通 |
| KI-6 | `index.ts` `/run` 加单条消息、messages 数组上限与 **Content-Length 预检**,超限 413 | `packages/agent/test/index-validation.test.ts` | 已跑通(Vitest) |

数据库相关项(KI-2 DB 层、KI-3、KI-5)的 pgTAP 需 `supabase start && supabase test db`;本分支已实跑通过(13/13)。

### 对修复的对抗式评审(2026-06-18)

对这批修复又做了一轮对抗式评审(5 个分区 reviewer + 逐条 refute),确认 4 条需处理、已全部修复,另 11 条经核查为 nit 或设计本意不予处理:

- **KI-1(regression)**:原「每次尝试独立 messageId + 失败补发 END」会把失败尝试残文定稿成重复气泡——已改回整轮单一 messageId(见上「实际采用的修复」),并补了「失败尝试已吐文本」的回归测试。
- **KI-2(incomplete)**:服务端幂等键在真实重发路径不生效,因客户端每次 `runAgent` 生成新 runId——已让 `client.ts` 在一逻辑轮内生成稳定 runId,并新增 `retry()` 在重试时复用它(而非重新 `sendMessage`)。
- **KI-6(low)**:大 body 在解析前未拦——已加 `Content-Length` 预检。
- 被驳回的 11 条:多为 dev 替身的细微差异、防御性建议(如非唯一索引、双斜杠 URL)、或已属设计本意/已接受的瑕疵。

---

## KI-1 重试循环未按尝试隔离状态与流式输出 — High

**一个根因,四种表现。** [`run.ts`](../packages/agent/src/run.ts) 的重试循环(`run.ts:98-131`)只重置累积变量(`deltas`/`options`/`assistantText`/`changed`),但 `state`、`textStarted`、`messageId` 都在循环外声明、跨尝试保留,且第一次尝试已通过 `yield*` 写进 SSE 流的事件无法撤回。`run.ts:94` 的注释「每次重试都从干净状态重新累积」对 `state` 而言不成立。

触发前提是真实存在的:按 [ADR-0003](./adr/0003-multi-step-tool-loop.md) 的多步流程,第一步先发工具调用(已 apply、已发 `STATE_DELTA`),传输层错误可能在其后到达([`ai-sdk-runtime.ts`](../packages/agent/src/model/ai-sdk-runtime.ts) 的 `error` part 抛出),于是进入第二次尝试。

### 表现 1:`state` 原地累加 → 重复实体 / `ApplyError` 整轮失败(High)

- **机制**:`state` 在 `run.ts:69` 取得唯一引用,`applyToolCall`(`run.ts:213` → `apply.ts`)对它原地 `push`/`splice`。第一次尝试 `add_character` 后抛错,`state.characters` 仍含该人物;第二次重发同一 `add_character` → 变成两个 id 不同的重复人物,经 `saveTurn` 写进权威 `documents.state`。
- **另一路径**:第一次 `add` 后 `remove`(`splice` 掉),第二次对该 id `update_*`/`remove_*` → `requireIndex` 找不到 → 抛 `ApplyError`(`apply.ts:42-44`)→ 整轮 `RUN_ERROR`,即便模型本身已成功生成。
- **校正**:原始调查里「`update_*` 命中错误下标、写错对象」这一说法不准确——`update_*`/`remove_*` 是按 id 用 `findIndex` 定位,存活的 id 总能命中正确对象;真正的失败方式是上面的 `ApplyError` 整轮中止。回归测试应钉住「重复 add」与「`ApplyError` 中止」两种,而非「写错对象」。

### 表现 2:失败尝试已发出的 SSE 事件收不回(Medium)

- **机制**:`streamOnce` 边收边 `yield` `TEXT_MESSAGE_CONTENT`(`run.ts:198`)与 `STATE_DELTA`(`run.ts:216`),`/run` 处理器逐个 `s.write` 进流(`index.ts:127-138`),无缓冲。客户端 SDK 收到即应用(`client.ts:125-126,137-139`)。第一次尝试在抛错前发出的事件已抵达并被应用,第二次尝试的内容再叠加上来。
- **影响**:重试进行中,用户先看到第一次尝试的文字与卡片,再看到第二次叠加——界面出现重复或拼接。注意:`saveTurn` 落库的内容是正确的(累积变量每次尝试已重置),所以这是「客户端临时显示」与「最终落库」的不一致,限于「失败尝试已产出部分输出」这个窗口,不涉及数据完整性或安全。

### 表现 3:`messages.deltas` 只记第二次尝试(Low,latent)

- **机制**:`deltas` 每次尝试清空(`run.ts:100`),`saveTurn` 落库的 `messages.deltas` 仅含第二次;但客户端实收的是两次之并。落库的 deltas 比 `documents.state` 的真实改动少记。
- **为何只算 Low**:`messages.deltas` 列**当前没有任何消费方**(对 `apps/` 与 `packages/` 全量检索确认:客户端续聊时不加载历史 messages,内联卡片由 `diffCard` 对账后状态算出,不读 `messages.deltas`)。`0001_init.sql:47-48` 描述的「续聊照原样重渲染」是 v1.1 的设想,尚未实现。所以这是「落库形态不正确,但暂无消费方暴露它」。一旦将来实现按 deltas 重放,同一根因会变成用户可见。

### 表现 4:`textStarted`/`messageId` 跨尝试保留(Medium)

- **机制**:二者在循环外声明(`run.ts:90-91`),不被重置块清除。`markTextStarted` 只在首段文本返回 true(`run.ts:111-114`),故第二次尝试的文本不再发 `TEXT_MESSAGE_START`,仍用同一 `messageId` 续发 `TEXT_MESSAGE_CONTENT`。客户端按 `textMessageBuffer + delta` 累加(`client.ts:125-126`),把两次文本拼接;而 `assistantText` 每次清空,`saveTurn` 只存第二次。
- **影响**:进行中显示「第一次+第二次」拼接文本;落库后只剩第二次,与刚才屏幕不符。

### 实际采用的修复

数据完整性是重点,流式即时性必须保住,因此**没有**采用「成功才 flush」的全缓冲(那会让常见的首次成功路径失去打字机式流式)。最终做法:

1. **每次尝试前对 `state` 深拷贝**(`structuredClone(loaded.state)`),仅在该尝试整段成功后才把副本提交为正式 `state`;失败丢弃副本,下一尝试从干净基线起跑。这消除「重复实体写进权威 `documents.state`」(表现 1)。
2. **失败需重试时,补发一条干净基线的 `STATE_SNAPSHOT`**,客户端据此退回失败尝试已应用的 `STATE_DELTA`,下一尝试重发。事件仍即时外发,流式不受影响(表现 2/3)。
3. **整轮共用同一 `messageId`,轮末只发唯一一条 `TEXT_MESSAGE_END`**。注意:一度尝试过「每次尝试用独立 `messageId` + 失败时补发 `TEXT_MESSAGE_END`」,但对这批修复的对抗式评审发现:失败尝试若已吐过文本,这会把残文定稿成**另一条** assistant 消息,客户端多出一条重复气泡、且与落库分叉——比改之前更糟。故改回整轮单一 `messageId`(表现 4)。

**残留的可接受瑕疵**:失败尝试已流式吐出的文本,会在同一条气泡里与重试文本短暂拼接显示;落库只存成功尝试的文本,重新载入会话即自我纠正。彻底消除需客户端在收到纠偏 `STATE_SNAPSHOT` 时清空本轮 `streamingText`(留待客户端侧处理)。

### 应加的回归测试(伪 provider + `MemoryStore`,离线)

- 第一次尝试发一次 `add_character` 后抛错,第二次成功并重发同一 `add_character`:断言落库 `state.characters.length === 1`、无重复 id。
- 第一次 `add` 后 `remove`、抛错,第二次对该 id `update`:断言不抛 `ApplyError`、整轮成功。
- 端到端不变量:把客户端实收的 `STATE_DELTA` 重放到基线得 `client_state`,把落库 `messages.deltas` 重放到基线得 `replay_state`,断言 `client_state == replay_state == documents.state`。
- 文本:重组客户端实收的 `TEXT_MESSAGE_CONTENT`,断言其等于落库 `assistantText`。

---

## KI-2 `save_turn` 无幂等键,重发同一轮重复落库 — Medium

- **现象 / 触发**:[`save_turn`](../supabase/migrations/0001_init.sql)(`0001_init.sql:177-223`)是纯顺序 INSERT/UPDATE,没有任何幂等键:无条件插 user 消息(`:194-197`)、assistant 消息(`:200-201`),`p_changed` 为真再插一条 `document_versions`(`:213-221`)。`messages` 无 `run_id` 列;`store.ts` 调 RPC 时不传 `runId`(`store.ts:168-176`);`run.ts` 虽生成 `runId` 却不放进 `saveTurn` 入参(`run.ts:154-162`)。现实重发路径:流式中途 SSE 断开,客户端 `onRunErrorEvent` 把 `isRunning` 复位(`client.ts:150-153`)后用户点重试,对同一 `threadId` 再发一次 `/run`;而服务端可能已执行到 `save_turn`。两次各落一轮 → 2 条 user + 2 条 assistant + 2 版 `document_versions`(`turn_index` N、N+1)。
- **影响**:续聊时 `loadSession` 按时间正序取最近消息,重复气泡进 prompt 与历史;`document_versions` 多一版且最大 `turn_index` 被抬高,污染版本序列(undo 将来回退到同一轮的重复版本)。
- **与设计的偏差**:system-design §11「重发本轮不产生脏数据」(`system-design.md:297`)。事务原子性只保证「单次执行全成或全败」,不提供跨次重发的 idempotency;已实现的 §11 机制只有重连补发 `STATE_SNAPSHOT`,它只收敛 `documents.state`,不阻止 messages/versions 的追加。
- **为何 Medium 而非 High**:不是必然触发,需要「服务端已落库但客户端重试」的竞争;后果是可恢复的历史/版本退化与重复气泡,无跨租户泄露或鉴权绕过。
- **修复选项**:① 给 `save_turn` 增参 `p_run_id`(`run.ts` 把 `input.runId` 透传),`messages` 加 `(session_id, run_id, role)` 唯一索引、`document_versions` 加 `(session_id, run_id)`,函数内 `INSERT ... ON CONFLICT DO NOTHING` 使重发成为幂等空操作。② 退一步:在 `/run` 入口按 `threadId` 加并发闸(见 KI-3),从源头减少重发落库。
- **回归测试**:同一 `threadId` 以相同 `runId` 调两次 `saveTurn`(`changed=true`),断言 messages 恰好 1 user + 1 assistant、`document_versions` 恰好 1 行;再以不同 `runId` 调一次,断言这才追加新行与自增 `turn_index`。

---

## KI-3 同会话并发 `save_turn` 竞争 `turn_index` — Medium

- **现象 / 机制**:`save_turn` 写 version 前 `select coalesce(max(turn_index),0)+1`(`0001_init.sql:214-217`),再插 `document_versions`,该列有唯一索引 `(session_id, turn_index)`(`:44-45`)。默认 READ COMMITTED 下,两个同会话并发调用各自读到同一个 N(对方未提交不可见),都算出 N+1、都插入 → 先提交者成功,后者撞 unique_violation。
- **原子性结论**:plpgsql 函数作为单个隐式事务执行,异常使本次调用整体回滚——user/assistant 消息、`documents.state`、`sessions.updated_at` 全部撤销,**无半截脏数据**(原子性成立)。但代价是败方整轮一字未存,经 `store.ts:177` 包成 `StoreError`、`run.ts:163-169` 转 `RUN_ERROR{code:'PERSIST_FAILED'}`。
- **触发**:§16 假设「同一会话同一时刻只跑一轮」,客户端用 `agent.isRunning` 守(`client.ts:170`),但服务端 `/run`(`index.ts:74-140`)无 per-session 串行化。两端设备、重发与原连接尾段重叠、或绕过客户端的直连,都能并发。
- **影响**:败方那一轮整体落库失败,用户见「落库失败」,该轮对话与剧本改动丢失(需重发)。
- **修复选项**:① `save_turn` 开头取 `pg_advisory_xact_lock(hashtext(p_session_id::text))` 或对 `sessions` 行 `SELECT ... FOR UPDATE`,串行化关键区,使第二个调用拿到 N+2、两轮都成功且 `turn_index` 连续。② 捕获 unique_violation 后重算 `max` 重试。③ 在 `/run` 入口按 `threadId` 做 per-session 串行闸(呼应 §16),从源头杜绝。
- **回归测试**:对同一 session 同时发起两次 `save_turn`(均 `changed=true`)。修复后断言两次都成功、`document_versions` 出现连续 `turn_index`;或在「干净拒绝」策略下断言败方返回可重试错误且无任何部分写。当前实现下该测试应观察到一方 unique_violation、其整轮被回滚(用以固化原子性、暴露整轮丢失)。

---

## KI-4 `verifyJwt` 未校验 issuer/audience — Low

- **现象 / 机制**:[`verifyJwt`](../packages/agent/src/auth.ts)(`auth.ts:73-79`)调 `jwtVerify` 只传 `{ algorithms }`,不传 `issuer`/`audience`,通过签名 + alg + exp 后即信任 `payload.sub`(`auth.ts:85`)。
- **残余风险(如实评估)**:跨项目伪造很难——JWKS 按 `SUPABASE_URL` 取(`auth.ts:46`)、HS256 用本项目 secret,外部攻击者无法造出能通过的 token。真正的具体风险是:agent 自己持有的 **service_role JWT**(`store.ts:76` 的 `SUPABASE_SERVICE_ROLE_KEY`,在 HS256 配置下由同一 secret 签名)若被当作 `Authorization: Bearer` 提交,会通过校验,其 `sub`(通常是 `"service_role"`)非空、过得了 `auth.ts:86` 仅有的 sub 存在性检查,于是被当成用户。要利用它需 service_role secret 泄露(本身已是更大的问题),故只算 Low。
- **明确不做的事**:**不**按 role 设门。匿名用户与正式用户一视同仁是产品本意(system-design §15/§16;config 开了匿名登录;`auth.ts` 保留 role 仅供日志)。上一轮评审里「断言 role 只能是允许角色」的建议据此**驳回**。
- **修复选项**:给两处 `jwtVerify` 传 `{ issuer: `${SUPABASE_URL}/auth/v1`, audience: 'authenticated' }`——Supabase 的用户 JWT(匿名与正式)`aud` 都是 `authenticated`,既兼容 §15/§16,又能拒绝并非面向终端用户签发的 token。
- **回归测试**:有效用户 token(正确 iss、`aud=authenticated`)→ 取出 `userId`;同 secret 签的 service_role token → 拒绝;iss 指向别的项目的 token → 拒绝;过期 token → 拒绝。当前代码下,前两条的「拒绝」会失败,正好暴露缺口。

---

## KI-5 `createSessionIfMissing` 非原子的两表创建 — Low

- **现象 / 机制**:[`createSessionIfMissing`](../packages/agent/src/store.ts)(`store.ts:134-163`)是「先查后插」:`maybeSingle` 查存在性(`:137-141`),不存在则做两次**独立**的 insert——`sessions`(`:151`)与 `documents`(`:159`),二者之间无事务包裹。
- **卡死路径**:若进程在两次 insert 之间死掉(Edge Function 的 CPU/墙钟上限,§12 明确列为真实风险),`sessions` 行存在而 `documents` 行缺失。下一轮 `createSessionIfMissing` 看到会话已存在即提前返回(`:143`),不再补建 `documents`;`loadSession` 对 `documents` 用 `.single()`(`:107`),0 行 → 报错 → 每一轮都 `RUN_ERROR{code:'LOAD_FAILED'}`。该会话经正常 API 无法再推进。
- **影响**:一个全新会话永久不可用,且无自我纠正路径。违反 §16 与 schema 注释「一会话 ⟷ 一剧本严格 1:1」(`0001_init.sql:27`)。`MemoryStore` 不受影响(它把一对行建成单个 map 条目,本就原子)。
- **为何 Low**:触发需崩溃恰好落在两次 `await` 之间的极短窗口,概率低;但单次发生的后果偏重(会话彻底卡死)。
- **修复选项**:① 用一个 security-definer RPC 把 session+document 原子建出(仿 `save_turn`)。② 让 `loadSession` 容忍缺失的 `documents` 行(`maybeSingle` + 缺则补建 `emptyScreenplay`)。③ 两处 insert 都用 `ON CONFLICT DO NOTHING`,顺带让并发首轮幂等而非 500。
- **回归测试**:(a) 预置一个有 `sessions`、无 `documents` 的会话,调 `loadSession`,断言它不再永久报错(能补建或自纠);(b) 对同一新 `threadId` 并发调两次 `createSessionIfMissing`,断言不出未处理的主键冲突 500、恰好一行 session + 一行 document。

---

## KI-6 `/run` 入口无输入大小上限 — Low

- **现象 / 机制**:`/run`(`index.ts`)只校验 `threadId` 存在(`:95`)与 user 消息非空(`:100`),`lastUserText`(`:51-71`)对长度无任何上限(多模态时还把各 text 片段全拼起来,无封顶)。对比之下 `/logline` 用 Zod 校验了 body(`LoglineBody`,`:45-48,155`),`/run` 没有。该输入原样进 prompt(`prompt.ts:126`)并存进 `messages.text`。
- **影响**:已登录(含匿名)用户用一个多兆字节的消息即可推高模型开销与延迟、或撞 Edge CPU/时间上限,并把大块文本写进 DB。§9「token 量有上界」只覆盖剧本状态与最近 N 轮窗口,不含单条新消息的大小,故该上界声明不完整。
- **修复选项**:给 `RunAgentInput` 加 Zod schema,对所选用户内容设长度上限(数 KB 量级),超限在调模型前返回 400/413;同时给 `input.messages` 数组长度与 `lastUserText` 的拼接结果封顶。
- **回归测试**:超大 user 消息的 `/run` 返回 400/413,且**不**调用模型 provider、不写 messages;正常大小通过。断言超限分支下 provider stub 从未被调用。

---

## 附:经核查不予立项(对抗验证驳回)

这三项调查里被提出、但逐条核查后判定**不是回归测试该钉的缺陷**,记录于此以免重复提出:

- **`document_versions` 只写不读(undo 未实现)**:是 v1 的有意范围。§15 已把「撤销 UI」列入 v1.1,§13 把每轮存版定位为「将来 undo 的前提」。当前 undo 无任何 v1 功能调用,运行时不会出错。最多是一处文档措辞:§11 把 undo 写成了现在时,可加一行注明 v1.1。**不写断言未实现行为的测试。**
- **JWKS 验签路径优先级**:`auth.ts` 的代码本身正确(两分支不共享密钥材料、按分支锁定算法白名单、`alg=none` 会被拒、JWKS 缓存/轮换交给 jose)。这是一条「测试覆盖建议」而非代码缺陷。可以测 JWKS 路径(mock 端点下 ES256 通过、`alg=none` 拒绝),但 jose 内部的拉取失败/冷却/轮换属框架代码,**不单测**。上一轮「把 JWKS 提到与 HS256 同级」的说法据此削弱为普通覆盖项。
- **`newConnection:true` 恒真**:v1 的客户端传输是每轮一条 SSE 连接(`client.ts` 每次 `runAgent` 都 POST 一条新请求),所以「每个 `/run` 都是新连接」字面成立,与 §6.2「若新连接先发 STATE_SNAPSHOT」一致,也是 §11 重连恢复所依赖的。是有意设计,非缺陷。若将来换成持久/多路复用连接才需要把 `newConnection` 变成真实信号。
