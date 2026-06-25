# 按需 Metro session 支持多 worktree 开发

> Status: accepted ·
> 记录 `pnpm dev:web`、`pnpm dev:ios`、`pnpm dev:android` 的 Metro 生命周期决定。

## 背景

Incipel 会在同一台机器上同时使用多个 git worktree。旧脚本把 Metro 固定在 `8081`,并假设同一时间只跑一个移动端开发环境。这个约定适合单个手动流程,但不适合 Claude 和开发者在多个 worktree 中并行开发、验证 UI 或调试设备。

Maestro E2E 不属于这条路径。ADR-0007 已决定 `pnpm e2e:ios` 使用 release build,JavaScript 内嵌在 app 内,不连接 Metro。dev-client + Metro 会显示开发者菜单,并且 `clearState` 会清掉 dev-client 保存的 Metro 地址,导致测试不能稳定进入首页。

## 决定

- 新增根命令 `pnpm dev:web`,作为 Claude 做移动 UI 开发的默认入口。
- `pnpm dev:web` 先运行 `tools/incipel-dev env sync`,再为本次命令选择一个空闲 Metro 端口,然后在 `apps/mobile` 下运行 `BROWSER=none EXPO_NO_TELEMETRY=1 npx expo start --web --localhost --port <port>`。
- `pnpm dev:ios -- --go`、`pnpm dev:ios -- --devbuild`、`pnpm dev:android -- --go`、`pnpm dev:android -- --devbuild` 保持手动设备验证职责。它们也为本次命令选择 Metro 端口,并把该端口用于 `/status` 检查、deep link、Android `adb reverse` 和 `expo start --port`。
- 端口选择由 `tools/incipel-dev/cli.mjs metro port` 执行。它按 worktree 真实路径计算候选端口,再让 operating system listener check 判断端口是否空闲;候选端口被占用时继续检查下一个端口。
- Metro 以前台进程运行。用户按 `Ctrl+C` 或工具结束该命令时,Metro 跟着退出。
- CORS middleware 必须在 agent routes 之前注册,并允许浏览器对 `/run` 和 `/logline` 发起 `POST` preflight 请求。

## 后果

- Metro 端口是本次命令的运行参数,不写入 `.worktree-dev.env`、`.env` 或长期 metadata。
- 旧 `.worktree-dev.env` 仍保存 Android serial、dev agent 端口、E2E simulator 名称和 E2E agent 端口,但不再负责 Metro。
- 多个 worktree 可以并行运行 `pnpm dev:web`。端口被无关进程占用时,脚本只选择下一个端口,不会停止该进程。
- iOS development 仍共用 `incipel-development` simulator,所以 simulator app 数据和已安装的 development build 不因本 ADR 隔离。
- Android 仍必须用 `adb -s <serial>` 指定设备;脚本会把本次 Metro 端口 reverse 到该设备。
- `pnpm e2e:ios` 继续使用 release build,不启动 Metro。

## 没选

- **worktree 创建时自动启动 Metro**:这会引入 background process、重启策略、日志和端口占用处理。当前需求只需要 Claude 或开发者在需要时启动 Metro。
- **Metro watcher / 自动重启**:这需要额外的后台进程负责检测 Metro 退出并重新启动,并要回答日志、退出原因、用户如何停止等问题。v1 不需要这些能力。
- **保存 Metro PID、日志路径或端口到 metadata**:Metro 生命周期已经由前台命令拥有,长期状态会增加清理和误判成本。
- **提供 `dx metro status/list/stop`**:v1 没有后台 Metro,所以不需要查看或停止后台 Metro 的命令。
- **把 release E2E 改成 dev-client + Metro**:这会与 ADR-0007 的测试稳定性决定冲突。
