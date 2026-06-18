# 多 worktree 并行跑模拟器

同一台机器上有多个 git worktree 时,让每个 worktree 跑在自己专属的模拟器实例上、互不干扰。
干扰点分布在前端(Metro、模拟器)与后端(agent 服务、Supabase)两侧,本文逐层说明隔离办法。

## 一句话用法

在任一 worktree 根目录:

```bash
pnpm dev:ios          # 本 worktree 专属 iOS 模拟器 + 专属 Metro 端口(Expo Go)
pnpm dev:android      # 本 worktree 选定的 Android 设备 + 专属 Metro 端口(Expo Go)
pnpm dev:agent        # 本 worktree 专属端口上的 agent 服务

pnpm dev:ios -- --dev-client      # 改用 development build
pnpm dev:android -- --dev-client
```

首次运行会在本 worktree 根目录生成 `.worktree-dev.env`(已被忽略,不入库),记下分到的 Metro / agent 端口与模拟器名,之后保持稳定;同时会按需从 `.env.example` 生成 `apps/mobile/.env` 与 `packages/agent/.env`,并把 agent 端口、`EXPO_PUBLIC_AGENT_URL` 写好(只动这两个键,密钥仍需你自己填一次)。

## 三层隔离

1. **Metro 端口**(`scripts/lib/worktree-dev-env.sh`)
   端口独占,默认 8081。脚本从 8081 起逐个挑一个「其它 worktree 未声明、且当前未被监听」的端口,写进 `.worktree-dev.env`。`--port` 是 Expo CLI 官方参数。

2. **Metro 缓存**(`apps/mobile/metro.config.js`)
   transform 缓存与 file-map 缓存默认都落在 `os.tmpdir()/metro-cache`(机器级共享),并发会写竞争。metro.config 按本 worktree 的绝对路径派生唯一缓存根目录 `os.tmpdir()/metro-incipel-<hash>`,**不依赖脚本**,直接 `expo start` 也隔离。

3. **模拟器定向**(`scripts/dev-ios.sh` / `scripts/dev-android.sh`)
   多台模拟器同时开机时,Expo CLI 默认指向「最近打开的那台」(expo/expo#42611)。
   - iOS:按模拟器名创建/复用一台(稳定 UDID),用 `xcrun simctl openurl <UDID>` 显式定向。
   - Android:用 `adb -s <serial> reverse` 把端口转发进指定设备,再 `am start` 打开。

## Agent 服务与 Supabase(后端进程)

模拟器只是前端,每个 worktree 的 app 还要连两个后端进程,它们各有自己的端口/状态,也会打架:

- **Agent 服务**(`pnpm agent:dev` → Hono,`PORT ?? 8787`)
  端口独占,两个 worktree 都起会撞车。`worktree-dev-env.sh` 从 8787 起为每个 worktree 分配独立 `AGENT_PORT`,写进 `packages/agent/.env` 的 `PORT` 与 `apps/mobile/.env` 的 `EXPO_PUBLIC_AGENT_URL`。`dev-agent.sh` 据此启动。
  - iOS 模拟器的 `localhost` 直通宿主机;**Android 模拟器的 `localhost` 是模拟器自身**,`dev-android.sh` 已对 agent 与 Supabase 端口一并 `adb reverse`,使两端都能用 `localhost`。

- **Supabase 本地栈**(`supabase start` → Docker,按 `project_id` 命名、端口写死)
  CLI 按 `project_id` 认栈,所以多个 worktree **共用同一套**,而非各得一套。真正的风险不是端口,而是共享了同一个数据库 / auth / storage:在一个 worktree 跑 `supabase db reset` 或改 `supabase/migrations`,会冲掉另一个 worktree 的数据。建议:
  1. **共用一套(默认)**:`supabase start` 一次,各 worktree 的 `.env` 都指向同一 API 端口(`.env.example` 的默认值);别在别人测试时 reset,migration 保持一致,用不同测试账号隔离数据。
  2. **不连 Supabase**:只做 UI / agent 迭代的 worktree,在 `packages/agent/.env` 设 `STORE=memory`、`DEV_NO_AUTH=1`,完全跳过——最轻的隔离。
  3. **每树一套独立栈(重)**:仅当真要隔离数据库时,给每个 worktree 不同的 `project_id` 与整段不同端口,代价是每套一组 Docker 容器、数 GB 内存;或改用云端 Supabase 的 branching。

## 不需要做的事(本拓扑下)

因为「每个 worktree 一台专属模拟器」,同一个 `com.incipel.app` 装在不同模拟器上不冲突,所以**无需**给每个 worktree 派生不同的 bundleIdentifier / scheme,**无需**改 Supabase 的 Additional Redirect URLs,AsyncStorage / 登录态也天然各自隔离。

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
- **首次该模拟器没装 Expo Go**:脚本会提示按 `shift+i`(iOS)/ `a`(Android)装一次,之后即可自动定向。
- **仓库出现 `/ios`、`/android` 原生目录**:managed 工作流下它们会盖过 `app.config.js`,建议加入 `.gitignore`。
