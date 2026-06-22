# 端到端测试:stub 模型的确定性回归,分三层,以 release 包为运行目标

「织幕」的端到端(E2E)测试用 Maestro 驱动 iOS app,**定位是导航、登录门控、AG-UI 事件流、持久化往返的确定性回归测试,模型行为明确不在其范围内**。为此 agent 提供一个 stub 模型 provider(`MODEL_PROVIDER=stub`:回放一条写死的轮——两段文字 + `set_meta` + 一个人物 + `propose_options`),让整条创作主路径离线、免 key、每次产出一致地跑。真实模型的行为不进 E2E,另由两条线覆盖:agent 的 `smoke` 脚本(真实 provider + 真 key,断言结构不变量,发版前 / 夜间手动跑),以及「录制真实轮当 fixture、经 stub 确定性回放」来压客户端对真实(往往更乱)产出的渲染。

> 术语:**stub**(给罐头答案)是测试替身里准确的词——`mock` 指会校验调用、我们不校验;`fake` 指能跑的内存实现,那是 `MemoryStore`。代码里这个 provider 一度叫 `fake`,已改名为 `stub`(`MODEL_PROVIDER=stub`、`createStubProvider`、`model/stub.ts`)。

## 三层(按需要多少后端切)

flow 按「需要多深的后端」分三层,用 Maestro 的 `--include-tags` 过滤:

- **`frontend-only`** — 只有 app(`EXPO_PUBLIC_DEV_NO_AUTH=1` 跳过登录、不起 agent)。覆盖纯界面:门控放行、欢迎页控件、建议 chip 回填、多语言切换。
- **`stub-agent`** — app + agent(stub 模型,`STORE=memory`、`DEV_NO_AUTH=1`)。覆盖创作主路径的接线:一条首轮流到人物卡 / 文档、肖像弹窗能打开、抽屉能唤出。这里的 agent 进程是**真的** Hono agent,被 stub 掉的只是模型。
- **`supabase`** — app(真实匿名登录,不设 `DEV_NO_AUTH`)+ agent(**仍是 stub 模型** + 真 SupabaseStore + 真 JWT 校验)+ 本地 Supabase。覆盖持久化往返:匿名登录、星标写回、历史续写。这层「真」的是持久化与鉴权,**不是模型**。

`frontend-only` + `stub-agent`(共 6 条)免 Supabase / Docker,是大头价值;`supabase`(3 条)最重。

## 跑 release 包,不跑 dev-client

E2E 以 **release 二进制(JS 内嵌)为运行目标**,不用 dev build + Metro。dev-client 那条有两处摩擦让它跑不通:加载 bundle 时会弹**开发者菜单**模态盖住界面;`launchApp clearState` 会清掉 dev-client 记的 Metro 地址、落到 dev-client launcher 而非欢迎页。release 包两样都没有(代码内嵌、不连 Metro、clearState 只清普通 app 数据),用 `clearState` 求每次干净起步也才成立。故 `pnpm e2e:ios` 做成 release runner,dev-client 入口砍掉。

`EXPO_PUBLIC_DEV_NO_AUTH` 是 bundle 期烘进去的,所以 `frontend-only`+`stub-agent`(开)与 `supabase`(关 + 填真 anon key)要各出一份 release 包。

## 选择器:点 testID,断言才用文案

flow **要『点』的控件一律给 testID**(开始创作、菜单、各 NavRow、chip、语言行 / 项、发送、返回、文档…),与文案 / 语言脱开;**文案只留给「断言内容」**(出现「林夏」、切完出现英文串)。理由是 app 尚早、文案在动、又是多语言,拿文案当点击目标注定常断。

Maestro 2.6.1 另有四处匹配坑,加锚点前必看(详见 `apps/mobile/.maestro/README.md`):①文本是**整串锚定**正则、不是 contains;②**多子 Pressable 的子文本被合并**成一个元素;③显式 `accessibilityLabel` **覆盖**子 Text 字形;④RN `<Modal>` 内部控件取不到(故肖像弹窗只验证「能打开」)。

## 何时跑

这套是合并前必跑的**人工强制关卡**:跑 `frontend-only` + `stub-agent` 这 6 条,通过才放行(macOS 的 CI 又贵又慢,先不全塞)。稳定后再把这 6 条挪进**路径过滤的 CI**(只在动 `apps/mobile` / `packages/agent` 的 PR 上跑)。`supabase` 那 3 条太重,留发版前手动 / 夜间。

## 推论(留给后来人)

- **绿 ≠ AI 没问题。** 它证明的是管线接通、屏能渲染、门控 / 持久化没坏;真实模型生成得好不好,看 agent `smoke` + fixture 那两条,别从 E2E 的绿里读。
- **Release 嵌入 JS 需要 `babel-preset-expo` 被 hoist**(pnpm 严格隔离下它只在 store 里):见根 `.npmrc`。Metro dev 不踩这坑,只 Release 的 `expo export:embed` 踩。
- **`supabase` 层会往共用的本地 Supabase 攒匿名用户 / 会话**(每次 clearState + 新匿名登录)。RLS 隔离、无害、不影响测试确定性;真要清得整套 `db reset`——但那是多 worktree 共用的栈、会冲掉别人数据,别随手做;真嫌脏的正解是每 worktree 一套独立 Supabase,而非随手 reset。
- **更广的覆盖(多轮 / 点选项进下一轮、聚焦 chip、文档面板、`/works`、登出、语言重启记忆…)有意推后**,记在 GitHub issue #33;当前范围是这 9 条 + 正在补的 `error-retry`。
