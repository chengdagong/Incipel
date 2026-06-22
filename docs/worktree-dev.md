# 多 worktree 共享开发 simulator 与服务

同一台机器上有多个 git worktree 时,日常 development 启动只使用一套开发环境:`pnpm dev:ios`
固定打开同一个 iOS simulator `incipel-development`,`pnpm dev:android` 指向显式选定的 Android 设备 / 模拟器,
Metro 固定使用 8081。本文件说明这些机器级资源如何复用,以及哪些场景仍需要 worktree 级隔离。

## 一句话用法

在任一 worktree 根目录:

```bash
pnpm dev:ios -- --go          # iOS 模拟器 + Expo Go + Metro 8081 + 自动起共用栈并后台 serve agent
pnpm dev:android -- --go      # Android 设备 + Expo Go + Metro 8081 + 自动起共用栈并后台 serve agent
pnpm dev:ios -- --devbuild    # iOS development build + Metro 8081 + 自动起共用栈并后台 serve agent
pnpm dev:android -- --devbuild
pnpm dev:agent        # (前台)起共用栈 + serve agent;想在专用终端看 agent 热重载日志时用

INCIPEL_SKIP_AGENT=1 pnpm dev:ios -- --go # 不自动起 agent(你已在别处前台跑 dev:agent 时)
```

`pnpm dev:ios` / `dev:android` 必须显式传 `--go` 或 `--devbuild`;不带参数会打印用法后退出。Google Sign-In 需要 development build,不能用 Expo Go 验证。启动脚本起 Metro 前会先调 `tools/incipel-dev up`:确保共用栈在运行、并在**后台** serve agent edge function(已在跑则跳过),所以平时一条带参数的命令就把前后端都带起来。新 worktree 首跑时,或 `apps/mobile/package.json` 新增直接依赖后,若 `apps/mobile` 依赖不完整,会先自动 `pnpm install`(pnpm 用全局 content-addressable store,命中时通常只是创建硬链接,不会重复下载,所以每个 worktree 装一次很轻;无需也无法靠全局安装 Expo 省掉)。首次运行还会在本 worktree 根目录生成 `.worktree-dev.env`(已被忽略,不入库);这个文件仍给 Android serial 与 E2E 的 iOS simulator 名称使用,但 `pnpm dev:ios` 会忽略其中的 `IOS_SIMULATOR_NAME`,始终使用 `incipel-development`。脚本会按需把 `apps/mobile/.env`、`supabase/.env` 写好。`supabase/.env` 本身也是 ignored 文件,新 worktree 没有这份文件时,`tools/incipel-dev` 会先从主工作区完整复制,再写入当前本地栈的 JWT 校验变量;如果已有旧 env 文件,它也会从主工作区补充 Google iOS client id 与 Supabase Google client secret。agent 已不是本地 Node 服务,**没有 per-worktree 端口**(见 [ADR-0008](adr/0008-edge-only-agent-runtime.md))。

首次使用 `--devbuild` 前,脚本会在目标设备缺少 `com.incipel.app` 时自动构建并安装 development build。这个步骤可能需要几分钟,完成后脚本会继续启动 Metro。iOS simulator 路径由脚本执行 `expo prebuild`、`pod install`、`xcodebuild` 与 `simctl install`;CocoaPods 需要的 `modular_headers` 由 `expo-build-properties` 写入生成配置,脚本不会直接修改 `Podfile`。本地 simulator build 使用 ad-hoc signing,使 app 携带 Keychain entitlement;Google 登录返回 `com.google.GIDSignIn Code=-2 "keychain error"` 时,先卸载旧 app 安装包再让脚本重建。不要手动用 `expo run:ios --device <UDID>` 代替,该命令在某些 Xcode / Expo CLI 组合下会走需要 code signing 的 device build 分支。

## 三类开发资源

1. **Metro 端口**(`scripts/lib/worktree-dev-env.sh`)
   固定 8081。我们总是只跑一个 dev 环境,不再为每个 worktree 错开端口(脚本以前从 8081 起避让分配,现已去掉)。直接 `expo start` 默认也是 8081,与脚本一致(`--port 8081` 显式传入)。

2. **Metro 缓存**(`apps/mobile/metro.config.js`)
   transform 缓存与 file-map 缓存默认都落在 `os.tmpdir()/metro-cache`(机器级共享),并发会写竞争。metro.config 按本 worktree 的绝对路径派生唯一缓存根目录 `os.tmpdir()/metro-incipel-<hash>`,**不依赖脚本**,直接 `expo start` 也隔离。

3. **设备定向**(`scripts/dev-ios.sh` / `scripts/dev-android.sh`)
   多台模拟器同时开机时,Expo CLI 默认指向「最近打开的那台」(expo/expo#42611)。
   - iOS development:所有 worktree 都创建/复用 `incipel-development` 这一台 simulator,用 `xcrun simctl openurl <UDID>` 显式定向。这样首次安装 development build 的成本只发生在这一台 simulator 上。
   - iOS E2E:`pnpm e2e:ios` 仍读取 `.worktree-dev.env` 的 `IOS_SIMULATOR_NAME`,继续使用 worktree 专属 simulator,避免 release 包和测试数据互相影响。
   - Android:用 `adb -s <serial> reverse` 把端口转发进指定设备,再 `am start` 打开。

## Agent 与 Supabase(后端)

agent 唯一运行时是 Supabase Edge Function(见 [ADR-0008](adr/0008-edge-only-agent-runtime.md)),它就跑在本地 Supabase 栈的 edge runtime 里——后端只剩「一套 Supabase 栈」这一个进程,不再有单独的 Node agent 端口。

- **agent(edge function)**:本地 `supabase start` **不会**自动 serve 函数,必须另跑 `supabase functions serve`(它常驻、热重载)。所以 `pnpm dev:ios` / `dev:android` 经 `tools/incipel-dev up` 在**后台**拉起这个 serve(detached,日志/PID 落 `os.tmpdir()`,探 `/health` 确认),不阻塞 Metro;想在前台看 agent 日志就单独 `pnpm dev:agent`(= `up` 的前台版,别和后台的同时跑)。两条路都会把 `apps/mobile/.env`(`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_AGENT_URL`)与 `supabase/.env`(`INCIPEL_SUPABASE_JWT_*`)写好。客户端一律指向共用栈的 `<api>/functions/v1/agent`(`api` 端口取自 `supabase/config.toml` 的 `[api]`,默认 54521)。`up` 会记录上次后台 serve 使用的 `supabase/.env` 内容;只要之后发现该文件内容变化,无论是 `up` 自动改的还是你手动改了 `OPENROUTER_MODEL` / `LOGLINE_MODEL`,已在 serve 的后台 agent 都会先停止 Edge Runtime 再重新启动,确保新环境变量生效。
  - 日常共用 dev 走 **Supabase anonymous auth**:无 session 时显示登录页,点击「先随便逛逛」创建 anonymous user;agent 校验 JWT 后使用 SupabaseStore 保存会话数据。不要把这条路径称作“免登录”;它仍有用户身份。
  - 主工作区的 `supabase/.env` 是日常 dev 的模型 secret 和 Google provider secret 来源。新 worktree 第一次启动时复制整份文件;如果已有旧模板但缺模型密钥或 `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`,`tools/incipel-dev` 只补这些项,不会覆盖已经写好的本地 JWT 校验变量。
  - iOS 模拟器的 `localhost` 直通宿主机;**Android 模拟器的 `localhost` 是模拟器自身**,`dev-android.sh` 已 `adb reverse` 共用栈的 API 端口——这一个端口就同时覆盖 `EXPO_PUBLIC_SUPABASE_URL` 与 `EXPO_PUBLIC_AGENT_URL`(agent 挂在它下面)。
  - **一份共用 function 同一时刻只有一套配置**(`MODEL_PROVIDER` / 本地 JWT 校验配置):几个 worktree 不能各跑各的 agent 配置;配置需求不同就去起隔离栈(下)。

- **Supabase 本地栈**(`supabase start` → Docker,按 `project_id` 命名、端口写死)
  CLI 按 `project_id` 认栈,所以多个 worktree **共用同一套**,而非各得一套。真正的风险不是端口,而是共享了同一个数据库 / auth / storage:在一个 worktree 跑 `supabase db reset` 或改 `supabase/migrations`,会冲掉另一个 worktree 的数据。建议:
  1. **共用一套(默认)**:`supabase start` 一次,各 worktree 的 `.env` 都指向同一 API 端口(`tools/incipel-dev` 会刷新这些值);别在别人测试时 reset,migration 保持一致,用不同匿名用户或测试账号隔离数据。
  2. **每树一套独立栈(E2E / 需隔离数据时)**:`pnpm e2e:stack up`(= `tools/incipel-dev e2e up`)按本 worktree 派生 `project_id` 与整段错开的端口,生成一份 gitignored 的 `.worktree-supabase/` workdir:链入 `migrations` / `seed`,复制 `functions`,并在 workdir 根目录链入 `packages`,确保 Edge Function 的相对 import 能解析到 agent 与 shared 源码。`supabase start --workdir` 起一套独立栈;`pnpm e2e:stack down` 拆掉。代价是每套一组 Docker 容器、数 GB 内存,故只在 E2E 或真要隔离数据库时用,日常仍只一套共用栈。

## 不需要做的事(本拓扑下)

因为日常 `dev:ios` 只跑一个 dev 环境,同一时间只需要一份 `com.incipel.app` development build,所以**无需**给每个 worktree 派生不同的 bundleIdentifier / scheme,**无需**改 Supabase 的 Additional Redirect URLs。注意:多个 worktree 通过 `dev:ios` 共用同一台 simulator 上的同一份 app 数据,AsyncStorage 与登录状态也会共用;需要隔离状态时,使用 `pnpm e2e:ios` 的 worktree 专属 simulator,或手动卸载 / 清理 `incipel-development` 上的 `com.incipel.app`。

> 只有当你想在**同一台**模拟器上并存多份 app 时,才需要动态 `app.config.js` + `APP_VARIANT` 派生不同标识,并把每个自定义 scheme 加进 Supabase 白名单。

## Android 多 AVD 启动

脚本不自动拉起 AVD(各人 SDK 路径与 AVD 名不同)。每个 worktree 一台、serial 各异:

```bash
emulator -list-avds
emulator -avd <名字> -port 5556     # serial = emulator-5556;再起一台用 5558……
```

多台在线时,在该 worktree 的 `.worktree-dev.env` 里把 `ANDROID_SERIAL` 填成对应 serial。

## 常见坑

- **`xcrun` 找不到 simctl**:若 `xcode-select -p` 指向 Command Line Tools(不含 simctl),`dev-ios.sh` 会自动回退到 `/Applications/Xcode.app` 的 `DEVELOPER_DIR`;若没装完整 Xcode 则报错提示 `sudo xcode-select -s /Applications/Xcode.app`。
- **dev build 不认自定义端口**:SDK 52 早期版本有此 bug(expo/expo#35542),已于 2025-03 修复并 backport。请把 `expo` 升到含修复的 patch 版,否则 `--port` 在 dev build 上失效。
- **首次目标设备没装 Expo Go**:脚本会提示按 `shift+i`(iOS)/ `a`(Android)装一次,之后即可自动定向。
- **仓库出现 `/ios`、`/android` 原生目录**:managed 工作流下它们会盖过 `app.config.js`,建议加入 `.gitignore`。
- **Google 登录返回 `Code=-2 "keychain error"`**:旧 simulator app 安装包可能没有 Keychain entitlement。执行 `xcrun simctl uninstall <UDID> com.incipel.app` 后再运行 `pnpm dev:ios -- --devbuild`,脚本会重新构建并安装。
