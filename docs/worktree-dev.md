# 多 worktree 共享开发 simulator 与服务

同一台机器上有多个 git worktree 时,日常 development 启动只使用一套开发环境:`pnpm dev:ios`
固定打开同一个 iOS simulator `incipel-development`,`pnpm dev:android` 指向显式选定的 Android 设备 / 模拟器,
Metro 固定使用 8081。本文件说明这些机器级资源如何复用,以及哪些场景仍需要 worktree 级隔离。

## 一句话用法

在任一 worktree 根目录:

```bash
pnpm dev:ios -- --go          # iOS 模拟器 + Expo Go + Metro 8081 + 共用 Supabase 栈
pnpm dev:android -- --go      # Android 设备 + Expo Go + Metro 8081 + 共用 Supabase 栈
pnpm dev:ios -- --devbuild    # iOS development build + Metro 8081 + 共用 Supabase 栈
pnpm dev:android -- --devbuild
pnpm dev:agent        # (前台)起共用 Supabase 栈 + 启动 agent server;需要 agent 或想看 agent 日志时用
pnpm dx up            # (后台)启动当前 worktree 的 agent server 和 watcher;明确需要后台 agent 时用
pnpm dx agent stop    # 停止当前 worktree 的后台 agent watcher / server,保留本地 Supabase 数据库等容器
```

`pnpm dev:ios` / `dev:android` 必须显式传 `--go` 或 `--devbuild`;不带参数会打印用法后退出。Google Sign-In 需要 development build,不能用 Expo Go 验证。启动脚本起 Metro 前会先调 `tools/incipel-dev env sync`:确保共用 Supabase 栈在运行,并按需写好 `apps/mobile/.env`、`supabase/.env`;它们不启动 agent server,也不检查 agent 是否已经在运行。需要 agent 时,另开终端运行 `pnpm dev:agent`;如果明确需要后台 agent,可手动运行 `pnpm dx up`,之后用 `pnpm dx agent stop` 停止。新 worktree 首跑时,或 `apps/mobile/package.json` 新增直接依赖后,若 `apps/mobile` 依赖不完整,会先自动 `pnpm install`(pnpm 用全局 content-addressable store,命中时通常只是创建硬链接,不会重复下载,所以每个 worktree 装一次很轻;无需也无法靠全局安装 Expo 省掉)。首次运行还会在本 worktree 根目录生成 `.worktree-dev.env`(已被忽略,不入库);这个文件保存 Android serial、dev agent 端口、E2E 的 iOS simulator 名称和 E2E agent port,但 `pnpm dev:ios` 会忽略其中的 `IOS_SIMULATOR_NAME`,始终使用 `incipel-development`。`supabase/.env` 本身也是 ignored 文件,新 worktree 没有这份文件时,`tools/incipel-dev` 会先从主工作区完整复制,再写入当前本地栈的 JWT 校验变量与 dev agent 端口;如果已有旧 env 文件,它也会从主工作区补充 Google iOS client id 与 Supabase Google client secret。日常 dev agent 端口默认是 `4111`,写入 `apps/mobile/.env` 的 `EXPO_PUBLIC_AGENT_URL` 与 `supabase/.env` 的 `AGENT_PORT`;`pnpm dev:agent` 发现该端口被占用时会询问是否改用下一个可用端口,同意后会把所选端口保存到 `.worktree-dev.env`,后续 `env sync` 继续使用该端口。E2E runner 另用 worktree 相关端口。

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

## Agent 与 Supabase

agent 当前运行时是 Mastra application,通过 Hono server adapter 在 Node server 中运行。Supabase 仍负责本地数据库、Auth、Storage。两者的 URL 分开:

- `EXPO_PUBLIC_SUPABASE_URL`:共用 Supabase 栈的 API URL,默认来自 `supabase/config.toml` 的 `[api].port`。
- `EXPO_PUBLIC_AGENT_URL`:日常 dev agent server base URL,默认为 `http://127.0.0.1:4111`;`pnpm dev:agent` 经用户确认改用下一个可用端口时,会把端口保存到 `.worktree-dev.env`,后续 `env sync` 写入对应 URL;E2E release runner 会在构建时临时改成 worktree 相关测试端口。

Expo Go / development build 的设置页可临时改 Agent 地址,支持 `IP:port`、`host:port` 与完整 `http/https` URL。这个值只保存在 app 的 AsyncStorage 中,不写回 `.env`;release build 不显示该设置,也不读取这份保存值。

`pnpm dev:ios` / `dev:android` 经 `tools/incipel-dev env sync` 只确保共用 Supabase 栈在运行并写好 env。它们不探 `/health`,不读取 agent metadata,不启动 agent server,也不启动 watcher。想启动 agent 就单独运行 `pnpm dev:agent`。如果需要后台 agent,手动运行 `pnpm dx up`;`up` 会读取 `os.tmpdir()/incipel-agent-serve-<worktree-hash>.json` 和 `os.tmpdir()/incipel-agent-watcher-<worktree-hash>.json`,确认其中的 `repoRoot` 等于当前 worktree,并核对源码 hash、`supabase/.env` hash 与 watcher 监控路径。watcher 监控 `packages/agent/src/**/*.ts`、`packages/agent/model.config.json`、`packages/shared/src/**/*.ts` 与 `supabase/.env`;这些文件变化后会重启当前 worktree 的 agent server。

- **Mastra Studio 本地 Screenplay tools**:Mastra Studio 里用于手工调试工具的 Agent 是 `studio-screenwriter`。它使用与生产 `screenwriter` 相同的静态 instructions 和 screenplay tool schema,但工具结果只写入 `packages/agent/.mastra-studio-screenplay.json`。使用 `read_studio_screenplay` 查看这份本地调试状态,使用 `reset_studio_screenplay` 重置为空 Screenplay。生产 `/run` 继续使用 `screenwriter` 和每轮动态生成的 `toolsets`,不会读写这份本地文件。
- `pnpm dx agent stop` 只停止当前 worktree metadata 记录的 agent watcher / server;它不会停止本地 Supabase 数据库、auth、storage 等其它容器。
- 日常共用 dev 走 **Supabase anonymous auth**:无 session 时显示登录页,点击「先随便逛逛」创建 anonymous user;agent 校验 JWT 后使用 SupabaseStore 保存会话数据。不要把这条路径称作“免登录”;它仍有用户身份。
- 主工作区的 `supabase/.env` 是日常 dev 的模型 secret 和 Google provider secret 来源。新 worktree 第一次启动时复制整份文件;如果已有旧模板但缺模型密钥或 `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`,`tools/incipel-dev` 只补这些项,不会覆盖已经写好的本地 JWT 校验变量。
- iOS 模拟器的 `localhost` 直通宿主机;**Android 模拟器的 `localhost` 是模拟器自身**,`dev-android.sh` 已 `adb reverse` Metro、Supabase API 与 `apps/mobile/.env` 里的 agent server 端口。这个端口转发不代表脚本会检查或启动 agent。
- 日常 dev agent server 默认使用端口 `4111`;`pnpm dev:agent` 发现该端口被占用时会询问是否改用下一个可用端口,并把确认后的端口保存到 `.worktree-dev.env`。E2E runner 和独立 Supabase stack 才使用 worktree 相关 agent 端口。Supabase 共用栈仍只有一套数据库/Auth/Storage。需要隔离数据时用独立栈。

- **Supabase 本地栈**(`supabase start` → Docker,按 `project_id` 命名、端口写死)
  CLI 按 `project_id` 认栈,所以多个 worktree **共用同一套**,而非各得一套。真正的风险不是端口,而是共享了同一个数据库 / auth / storage:在一个 worktree 跑 `supabase db reset` 或改 `supabase/migrations`,会冲掉另一个 worktree 的数据。建议:
  1. **共用一套(默认)**:`supabase start` 一次,各 worktree 的 `.env` 都指向同一 API 端口(`tools/incipel-dev` 会刷新这些值);别在别人测试时 reset,migration 保持一致,用不同匿名用户或测试账号隔离数据。
  2. **每树一套独立栈(E2E / 需隔离数据时)**:`pnpm e2e:stack up`(= `tools/incipel-dev e2e up`)按本 worktree 派生 `project_id` 与整段错开的端口,生成一份 gitignored 的 `.worktree-supabase/` workdir:链入 `migrations` / `seed`,写出隔离栈自己的 `agent.env`,并打印 `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_AGENT_URL`。`supabase start --workdir` 起一套独立 Supabase 栈;agent 仍用 `pnpm --filter @incipel/agent start` 启动。`pnpm e2e:stack down` 拆掉 Supabase 栈。代价是每套一组 Docker 容器、数 GB 内存,故只在 E2E 或真要隔离数据库时用,日常仍只一套共用栈。

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
