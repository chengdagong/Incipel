# Maestro E2E 套件

在真实 iOS 模拟器上驱动「织幕」客户端,覆盖登录门控、欢迎页、完整一轮创作、人物肖像、
抽屉导航、星标、历史续写、多语言切换。

## 方案与后续(见 [ADR-0007](../../../docs/adr/0007-e2e-test-strategy.md))

测试策略经一次 review 定论,记在 ADR-0007。**绿 ≠ AI 没问题**:这 9 条覆盖主路径(启动→欢迎、
登录门控、一条创作首轮、持久化往返、i18n),**模型行为不在 E2E 范围**(交给 agent `smoke` +
录真实一轮当 fixture 回放)。

几条**已定、待迁移**的方向(下面正文仍是迁移前的当前状态,各项迁移单独开 issue 跟):

- **三层改名**:`offline` / `fake` / `supabase` → `frontend-only` / `stub-agent` / `supabase`。
- **stub,不叫 fake**:回放写死一轮的模型 provider 是 **stub**(给罐头答案,测试术语里 `mock` 指校验
  调用、`fake` 指能跑的内存实现);代码里 `fake` 改 `stub`。
- **release runner**:`pnpm e2e:ios` 改跑 release 包,dev-client 入口砍掉(理由见下「dev build vs release build」)。
- **点 testID、断言才用文案**:flow 要点的控件都给 testID(与文案 / 语言脱开),文案只留给断言内容。

**有意推后、现在没测的**(记在 [issue #33](https://github.com/chengdagong/Incipel/issues/33)):多轮 /
点选项进下一轮、聚焦 chip、文档面板、`/works`、登出、语言重启记忆、更全的剧本渲染;出错重试
(`error-retry`)本轮就补。

**supabase 层会攒数据**:每条 flow 都 clearState + 新匿名登录 → 每次一个新匿名用户并写一条会话,
共用的本地 Supabase 会越积越多。RLS 隔离、不影响测试、无害;真要清得整套 `db reset`(共用栈、会冲掉
别人数据,别随手做),嫌脏的正解是每 worktree 一套独立 Supabase。

## 怎么跑

经 worktree 感知的运行器(它会接好本 worktree 专属的端口 / 模拟器 / fake agent):

```bash
bash scripts/e2e-ios.sh              # 默认 offline,fake 两层(免 Supabase)
bash scripts/e2e-ios.sh offline      # 只跑无后端的纯 UI 流
bash scripts/e2e-ios.sh fake         # 只跑 fake agent 的创作主路径
bash scripts/e2e-ios.sh supabase     # 需真实匿名登录 + 本地 Supabase 的流
# 等价入口:pnpm e2e:ios [层]
```

直接用 Maestro(自行接好端口 / 设备时):

```bash
maestro --device <模拟器 UDID> test --include-tags offline,fake apps/mobile/.maestro/
```

### 前置

- 已装 [Maestro](https://maestro.mobile.dev):`curl -fsSL "https://get.maestro.mobile.dev" | bash`
- dev build 已装到本 worktree 模拟器:先跑过一次 `pnpm dev:ios --dev-client`(建模拟器 + `expo run:ios`)。
  运行器复用已装的 app,不每次重建。
- `supabase` 层另需:`supabase start`;`packages/agent/.env` 填好 `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET`;`apps/mobile/.env` 填好真实
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`,且**不设** `EXPO_PUBLIC_DEV_NO_AUTH`(运行器会按层自动改并在退出时还原)。

## 三层(按后端依赖切)

| 层 tag | 进程 / 开关 | 覆盖 |
|---|---|---|
| `offline` | 仅 app(`DEV_NO_AUTH` bundle),不起 agent | 登录门绕过、欢迎页控件、建议 chip 回填、多语言切换 |
| `fake` | app(`DEV_NO_AUTH`)+ agent(`MODEL_PROVIDER=fake STORE=memory DEV_NO_AUTH=1`) | 一轮创作、肖像生成、抽屉基础导航 |
| `supabase` | app(真实匿名登录,不设 `DEV_NO_AUTH`)+ agent(`MODEL_PROVIDER=fake` + 真 SupabaseStore) | 匿名登录冒烟、星标、历史续写 |

分层的原因:抽屉 / 历史 / 作品的会话列表是**客户端直连 Supabase** 查的
(`src/drawer/DrawerProvider.tsx`、`app/(app)/history.tsx`),agent 的内存 store 它们看不到;
所以这些「列表 / 星标」类只能放在真实 Supabase 那层。而一轮创作的人物卡来自 **AG-UI 实时流**、
肖像是**纯客户端占位**,故在 fake 层就能确定性地跑。

> `offline` 与 `fake` 共用 `DEV_NO_AUTH=1` 的 bundle;`supabase` 需要不设该开关的另一份 bundle。
> 两者**不能同跑**——分两次,运行器会拦住误用。

## fake provider

`packages/agent/src/model/fake.ts` 的 `createFakeProvider()`:`MODEL_PROVIDER=fake` 时由工厂返回,
产出一条**写死**的一轮——两段文字 + `set_meta`(标题「深夜来电」)+ `add_character`(人物「林夏」)+
`propose_options`(两个走向)。它走与真实 provider 同一条核心循环(`runTurnCore`),
tool-call 参数先过当轮 Zod schema 校验再产出,形状不偏离真实路径。`completeLogline` 返回固定一句,
欢迎页骰子(`/logline`)离线可用。**prod 永不设 `MODEL_PROVIDER=fake`。**

这一轮内容写死,故 Maestro 用可见文本做断言锚点:助手名 `主管编剧`、人物 `林夏`、
卡片底部 `已存入剧本草稿` / `打开文档全文 →`、引导项 `先挖她的过去`。

## 流程一览

```
subflows/                被 runFlow 复用,不独立跑
  enter-welcome.yaml       DEV_NO_AUTH 直达欢迎页(offline/fake)
  enter-welcome-anon.yaml  真实匿名登录到欢迎页(supabase)
  run-one-turn.yaml        从欢迎页跑出 fake 的一轮(停在对话屏)
flows/
  smoke-dev-no-auth.yaml   [offline] DEV_NO_AUTH 跳登录直达欢迎页
  welcome-controls.yaml    [offline] 欢迎页控件 + 建议 chip 回填输入(不触后端)
  i18n-switch.yaml         [offline] 设置里切 English,断言界面变英文
  creative-turn.yaml       [fake]    创作主路径:一轮的流式回复 + 人物卡 + 文档沉淀 + 选项
  portrait-generate.yaml   [fake]    人物卡 → 生成肖像 → 选风格 → 生成 → 绘制中 → 完成
  drawer-nav.yaml          [fake]    抽屉唤出 / 导航 / 遮罩关闭(空列表)
  smoke-anon-login.yaml    [supabase] 匿名登录冒烟(原 anon-login.yaml 的修正版)
  star-session.yaml        [supabase] 一轮落进数据库 → 抽屉星标 → 变实心
  history-resume.yaml      [supabase] 一轮落进数据库 → 历史页出现 → 续写回对话屏
```

## 选择器约定

默认界面语言是简体中文(`zh`)。Maestro 按**可见中文文案**与已有 `accessibilityLabel`
(`菜单` / `发送` / `返回` / `关闭抽屉` / `设置` / `重新生成`)选元素。

只在「重复出现 / 纯文案无法区分」处加了少量 `testID`:

| testID | 位置 | 为什么 |
|---|---|---|
| `char-portrait-gen-<人物id>` | `PortraitThumb`「生成肖像」 | 同屏多人物时文案相同 |
| `char-chat-<人物id>` | `InlineCard`「聊聊 TA →」 | 同屏多人物时文案相同 |
| `session-row-<会话id>` / `session-star-<会话id>` | `Drawer` 会话行 / 星标 | 每会话一行,标题可能不唯一 |
| `work-card-<作品id>` | `works.tsx` 作品卡 | 每行可点区域文案相同 |
| `history-row-<会话id>` / `history-delete-<会话id>` | `history.tsx` 续写行 / 删除 | 每行文案相同 |
| `portrait-generate` | `PortraitSheet`「生成」按钮 | 与弹窗标题「生成「…」的肖像」文案相撞 |

会话 / 人物 id 由服务端生成、跑前不可知,故流程里用 `id: "session-star-.*"` 这类**前缀正则**
(单条数据下不歧义)。

> **两条 2.6.1 实测得来的硬规矩,加锚点前必看:**
>
> 1. **文本匹配是「整串锚定」正则,不是 contains**:选择器作正则去**整串匹配**元素文本。所以
>    「开始创作 →」用裸 `开始创作` 命不中(只是子串),要 `.*开始创作.*`;`8082` 命不中
>    「http://…:8082」,要 `.*8082.*`。
> 2. **多子 Pressable 的文本会被合并成一个 accessibility 元素**:RN 的可点元素(`accessible` 默认 true)
>    把子节点文本拼成一串。所以语言行(`界面语言`+`简体中文`+`▾`)、`会话` NavRow(带计数徽标)、
>    选项行(`▸`+文案)、人物卡底部(点+`已存入剧本草稿`+`打开文档全文`)、抽屉会话行(标题+时间)
>    里的**单条**文案都命不中裸文案,要 `.*…*`。
>
> 合起来的判断法:**元素(含它在可点容器里合并进来的兄弟文本)的完整文本恰好等于你的串吗?** 等于
> 才用裸文案(如独立 Text `主管编剧`/`林夏`、显式 `accessibilityLabel` `菜单`/`设置`/`返回`、单子
> Pressable 的 chip `一段无法言说的关系`);只要是其中一段,就 `.*…*`。重复/服务端 id 的控件用
> `testID` 前缀正则(`session-star-.*`)。
>
> **RN `<Modal>` 的内部控件 Maestro 取不到**:PortraitSheet 是 Modal,标题(Text)能露出来,但里面的
> 风格 chip / 生成按钮(连 testID、坐标点都)取不到。故 `portrait-generate` 只验证「弹窗能打开」。

## 已知边界

- `/works` 作品页已注册路由(`app/(app)/_layout.tsx`),但 v1 里没有任何界面入口导航到它
  (抽屉只通到 `/history` 与 `/settings`)。故作品页未经 UI 流程覆盖;持久化列表用历史页
  (`history-resume`)代表。日后给作品页接上入口时再补一条流程。
- 真实模型路径(`anthropic` / `openrouter`)不在 E2E 内,靠 agent 的 `pnpm --filter @incipel/agent smoke`
  手动核(需真实 key)。
- 本地 Supabase 栈多 worktree 共用:`supabase` 层会写测试会话(RLS 限定在该匿名用户),
  别与其它 worktree 同时跑写数据库的测试;本套件不跑 `supabase db reset`。

## dev build vs release build(2026-06 在 Xcode 26.5 实测)

实跑发现两件影响「能否稳定跑绿」的事,记此备忘:

1. **装 dev build:`expo run:ios` 在 Xcode 26.5 上不可用**——它把模拟器误判成物理设备、要求
   code signing 而失败(`expo run:ios --device <sim-udid>` 与裸 `expo run:ios` 都如此;prebuild
   与 CocoaPods 本身正常)。绕法:prebuild 后直接
   `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -workspace ios/app.xcworkspace
   -scheme app -configuration Debug -sdk iphonesimulator -destination "id=<UDID>"
   -derivedDataPath ios/build CODE_SIGN_IDENTITY="-"`,再 `simctl install` + `simctl launch`
   (ad-hoc 签名自带 get-task-allow,可正常启动)。

2. **dev build 不适合稳定自动化,建议用 release/preview build**:
   - dev-client 在「重新加载 bundle」(launcher 选 server / deep-link)时会弹**开发者菜单**(模态),
     盖住界面;Maestro 看不到被模态盖住的元素 → 断言失败。
   - `launchApp: { clearState: true }` 会清掉 dev-client 记住的 Metro URL → 落到 dev-client launcher
     而非欢迎页。普通 `launchApp`(不清态、自动重连上次 URL)则直达欢迎页、无开发者菜单。
   - **已用 release 包实测全部通过(2026-06):offline 3/3 + fake 3/3 + supabase 3/3 = 9/9。**
     release 二进制 JS 内嵌、不连 Metro,彻底避开 launcher 与开发者菜单,`clearState` 正常 ——
     这才是 Maestro E2E 的标准目标。本套件 flow 按「标准 standalone build」写(用 `clearState` 求确定性)。

### 实测配方:offline + fake(免 Supabase)

```bash
cd apps/mobile
# 1) bundle 期开关:offline/fake 用 DEV_NO_AUTH=1(在 .env 设 EXPO_PUBLIC_DEV_NO_AUTH=1)
# 2) Release 构建(JS 内嵌)。babel-preset-expo 需 hoist(见根 .npmrc;或 pnpm install 后已就位)。
#    复用 derivedDataPath 时先 `find ios/build-release -name main.jsbundle -delete` 逼 bundle 重跑,
#    否则 Xcode 认 output 最新会跳过 → 烘进旧 .env。
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PATH="$HOME/.local/bin:$PATH" \
  xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Release \
  -sdk iphonesimulator -destination "id=<sim-UDID>" -derivedDataPath ios/build-release \
  CODE_SIGN_IDENTITY="-"
# 3) 装到模拟器(换掉 dev build)
xcrun simctl install <sim-UDID> ios/build-release/Build/Products/Release-iphonesimulator/app.app
# 4) 跑(release 不需 Metro;fake 层另起 fake agent:PORT=<AGENT_PORT> MODEL_PROVIDER=fake
#    STORE=memory DEV_NO_AUTH=1,.env 的 EXPO_PUBLIC_AGENT_URL 指向它)
maestro test --device <sim-UDID> --include-tags offline,fake apps/mobile/.maestro/
```

### 实测配方:supabase(需本地 Supabase)

```bash
# 0) 本地 Supabase 栈起着(docker + supabase start);schema 已应用(sessions/documents/messages 在)。
#    keys 从 `supabase status -o env` 取。多 worktree 共用栈:别跑 db reset。
# 1) bundle 期:.env 里 EXPO_PUBLIC_DEV_NO_AUTH 留空(登录门要在)、EXPO_PUBLIC_SUPABASE_URL=
#    http://127.0.0.1:54521、EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon>。另出一份 release 包(同上)并安装。
# 2) agent 用真实 SupabaseStore + 真鉴权(不设 STORE/DEV_NO_AUTH):
( cd packages/agent && env PORT=<AGENT_PORT> MODEL_PROVIDER=fake \
    SUPABASE_URL=http://127.0.0.1:54521 SUPABASE_SERVICE_ROLE_KEY=<sr> \
    SUPABASE_JWT_SECRET=<jwt-secret> node_modules/.bin/tsx src/index.ts ) &
# 3) 跑:真实匿名登录 → fake 那一轮经 agent 落进数据库 → 抽屉/历史读回 → 星标写回
maestro test --device <sim-UDID> --include-tags supabase apps/mobile/.maestro/
```

> 注:`scripts/e2e-ios.sh` 目前走 dev-client + Metro(便于交互式开发),有上述开发者菜单/clearState 摩擦;
> 要全部通过请按上面的 release 配方(后续可给 runner 加一个 `--release` 模式)。
