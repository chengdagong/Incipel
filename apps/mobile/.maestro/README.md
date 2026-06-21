# Maestro E2E 套件

在真实 iOS 模拟器上驱动「织幕」客户端,覆盖登录门控、欢迎页、完整一轮创作、人物肖像、
抽屉导航、星标、历史续写、多语言切换、出错重试。

## 方案(见 [ADR-0007](../../../docs/adr/0007-e2e-test-strategy.md))

测试策略经一次 review 定论,记在 ADR-0007。**绿 ≠ AI 没问题**:这些 flow 覆盖主路径(启动→欢迎、
登录门控、一条创作首轮、持久化往返、i18n、出错重试),**模型行为不在 E2E 范围**(交给 agent `smoke` +
录真实一轮当 fixture 回放)。

**有意推后、现在没测的**(记在 [issue #33](https://github.com/chengdagong/Incipel/issues/33)):多轮 /
点选项进下一轮、聚焦 chip、文档面板、`/works`、登出、语言重启记忆、更全的剧本渲染。

**supabase 层会攒数据**:每条 flow 都 clearState + 新匿名登录 → 每次一个新匿名用户并写一条会话,
共用的本地 Supabase 会越积越多。RLS 隔离、不影响测试、无害;真要清得整套 `db reset`(共用栈、会冲掉
别人数据,别随手做),嫌脏的正解是每 worktree 一套独立 Supabase。

## 怎么跑

经 worktree 感知的 release 运行器(按 worktree 接好端口 / 模拟器,按层出 release 包、装好、起 stub agent):

```bash
bash scripts/e2e-ios.sh                       # 默认 frontend-only,stub-agent 两层(免 Supabase)
bash scripts/e2e-ios.sh frontend-only         # 只跑无后端的纯 UI 流
bash scripts/e2e-ios.sh stub-agent            # 只跑 stub agent 的创作主路径
bash scripts/e2e-ios.sh supabase              # 需真实匿名登录 + 本地 Supabase 的流
bash scripts/e2e-ios.sh frontend-only --no-build  # 复用已装包、只重跑 Maestro(改 flow 时省一次构建)
# 等价入口:pnpm e2e:ios [层] [--no-build]
```

运行器每步做了什么(为什么跑 release 包、不跑 dev-client,见 ADR-0007「跑 release 包」):

1. 按层把 `apps/mobile/.env` 的 `EXPO_PUBLIC_DEV_NO_AUTH` 改成该层所需(frontend-only/stub-agent = `1`、
   supabase = 空)——这是 **bundle 期**开关,必须在构建前写好;
2. 首次自动 `expo prebuild` + `pod install` 生成 `ios/`(已被 gitignore),之后复用;
3. 复用 `derivedDataPath` 时先删 `main.jsbundle` 逼 bundle 重跑(否则 Xcode 认 output 最新会跳过 → 烘进旧 `.env`);
4. `xcodebuild -configuration Release`(JS 内嵌)出包,`simctl install` 换包;
5. stub-agent / supabase 层另起 stub agent(`MODEL_PROVIDER=stub`);
6. `maestro test --device <UDID> --include-tags <层>`;退出时把 `.env` 的 `DEV_NO_AUTH` 还原。

直接用 Maestro(自行接好设备 / 包时):

```bash
maestro test --device <模拟器 UDID> --include-tags frontend-only,stub-agent apps/mobile/.maestro/
```

### 前置

- 已装 [Maestro](https://maestro.mobile.dev)(`curl -fsSL "https://get.maestro.mobile.dev" | bash`)与 JDK 17+。
- 完整 Xcode(`xcodebuild` / `simctl`)与 CocoaPods(`brew install cocoapods`)。运行器会在
  `xcode-select` 指向 CommandLineTools 时回退到 `/Applications/Xcode.app`,无需 `sudo xcode-select`。
- `supabase` 层另需:`supabase start`;`packages/agent/.env` 填好 `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET`;`apps/mobile/.env` 填好真实
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`,且**不设** `EXPO_PUBLIC_DEV_NO_AUTH`(运行器会按层自动改并在退出时还原)。

## 三层(按后端依赖切)

| 层 tag | 进程 / 开关 | 覆盖 |
|---|---|---|
| `frontend-only` | 仅 app(`DEV_NO_AUTH` bundle),不起 agent | 登录门绕过、欢迎页控件、建议 chip 回填、多语言切换 |
| `stub-agent` | app(`DEV_NO_AUTH`)+ agent(`MODEL_PROVIDER=stub STORE=memory DEV_NO_AUTH=1`) | 一轮创作、肖像弹窗、抽屉基础导航、出错重试 |
| `supabase` | app(真实匿名登录,不设 `DEV_NO_AUTH`)+ agent(`MODEL_PROVIDER=stub` + 真 SupabaseStore) | 匿名登录冒烟、星标、历史续写 |

分层的原因:抽屉 / 历史 / 作品的会话列表是**客户端直连 Supabase** 查的
(`src/drawer/DrawerProvider.tsx`、`app/(app)/history.tsx`),agent 的内存 store 它们看不到;
所以这些「列表 / 星标」类只能放在真实 Supabase 那层。而一轮创作的人物卡来自 **AG-UI 实时流**、
肖像是**纯客户端占位**,故在 stub-agent 层就能确定性地跑。

> `frontend-only` 与 `stub-agent` 共用 `DEV_NO_AUTH=1` 的 bundle;`supabase` 需要不设该开关的另一份 bundle。
> 两者**不能同跑**——分两次,运行器会拦住误用。

## stub provider

`packages/agent/src/model/stub.ts` 的 `createStubProvider()`:`MODEL_PROVIDER=stub` 时由工厂返回,
产出一条**写死**的一轮——两段文字 + `set_meta`(标题「深夜来电」)+ `add_character`(人物「林夏」)+
`propose_options`(两个走向)。它走与真实 provider 同一条核心循环(`runTurnCore`),
tool-call 参数先过当轮 Zod schema 校验再产出,形状不偏离真实路径。`completeLogline` 返回固定一句,
欢迎页骰子(`/logline`)离线可用。**prod 永不设 `MODEL_PROVIDER=stub`。**

> 术语:**stub**(给罐头答案)是测试替身里准确的词(`mock` 指会校验调用、`fake` 指能跑的内存实现,
> 那是 `MemoryStore`)。另有 `test/helpers/stub-provider.ts` 的 `stubProvider(scripts)`——单测里按脚本
> 组装任意序列(含抛错)的可编程 stub。两者都是「给罐头答案」的 stub。

这一轮内容写死,故 Maestro 用可见文本做断言锚点:助手名 `主管编剧`、人物 `林夏`、
卡片底部 `已存入剧本草稿` / `打开文档全文 →`、引导项 `先挖她的过去`。

## 流程一览

```
subflows/                被 runFlow 复用,不独立跑
  enter-welcome.yaml       DEV_NO_AUTH 直达欢迎页(frontend-only/stub-agent)
  enter-welcome-anon.yaml  真实匿名登录到欢迎页(supabase)
  run-one-turn.yaml        从欢迎页跑出 stub 的一轮(停在对话屏)
flows/
  smoke-dev-no-auth.yaml   [frontend-only] DEV_NO_AUTH 跳登录直达欢迎页
  welcome-controls.yaml    [frontend-only] 欢迎页控件 + 建议 chip 回填输入(不触后端)
  i18n-switch.yaml         [frontend-only] 设置里切 English,断言界面变英文
  creative-turn.yaml       [stub-agent]    创作主路径:一轮的流式回复 + 人物卡 + 文档沉淀 + 选项
  portrait-generate.yaml   [stub-agent]    人物卡 → 生成肖像 → 选风格 → 生成 → 绘制中 → 完成
  drawer-nav.yaml          [stub-agent]    抽屉唤出 / 导航 / 遮罩关闭(空列表)
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

## 手动构建(调试用,2026-06 在 Xcode 26.5 实测)

运行器已封装下面这套;手动复现或调试时可照做:

```bash
cd apps/mobile
# 1) bundle 期开关:frontend-only/stub-agent 用 DEV_NO_AUTH=1(在 .env 设 EXPO_PUBLIC_DEV_NO_AUTH=1);
#    supabase 留空 + 填真 anon key。该开关在 bundle 期烘进二进制,两组要各出一份包。
# 2) 首次生成原生工程(ios/ 已 gitignore):
npx expo prebuild --platform ios --no-install && ( cd ios && LANG=en_US.UTF-8 pod install )
# 3) Release 构建(JS 内嵌)。复用 derivedDataPath 时先删 main.jsbundle 逼 bundle 重跑:
find ios/build-release -name main.jsbundle -delete 2>/dev/null || true
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PATH="$HOME/.local/bin:$PATH" \
  xcodebuild -workspace ios/<scheme>.xcworkspace -scheme <scheme> -configuration Release \
  -sdk iphonesimulator -destination "id=<sim-UDID>" -derivedDataPath ios/build-release \
  CODE_SIGN_IDENTITY="-"
# 4) 装到模拟器
xcrun simctl install <sim-UDID> ios/build-release/Build/Products/Release-iphonesimulator/<scheme>.app
# 5) 起 stub agent(stub-agent 层):PORT=<AGENT_PORT> MODEL_PROVIDER=stub STORE=memory DEV_NO_AUTH=1
#    (supabase 层改用真 SupabaseStore:不设 STORE/DEV_NO_AUTH,填 SUPABASE_URL/SERVICE_ROLE_KEY/JWT_SECRET)
maestro test --device <sim-UDID> --include-tags frontend-only,stub-agent apps/mobile/.maestro/
```

实测得来的两条坑:

- **`expo run:ios` 在 Xcode 26.5 上不可用**(把模拟器误判成物理设备、要 code signing 而失败),故走
  上面 `xcodebuild` 直构 + `simctl install`(ad-hoc 签名 `CODE_SIGN_IDENTITY="-"` 自带 get-task-allow,
  可正常启动)。别加 `CODE_SIGNING_ALLOWED=NO` 再手动 `codesign --deep` 重签——会丢 get-task-allow,
  启动报 POSIX 163。
- **Release 嵌入 JS 需要 `babel-preset-expo` 被 hoist**(pnpm 严格隔离下它只在 store):见根 `.npmrc`
  的 `public-hoist-pattern[]=babel-preset-expo`,`pnpm install` 后就位。Metro dev 不踩这坑,只
  Release 的 `expo export:embed` 踩。
