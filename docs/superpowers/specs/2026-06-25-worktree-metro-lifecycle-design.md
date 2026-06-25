# Worktree Metro Lifecycle Design

Status: approved for implementation planning
Date: 2026-06-25

## Goal

让每个需要移动端或 React Native Web 开发的 worktree 都能拥有一个可识别、可查询、可停止的 Metro server。

Metro 端口只在 Metro 第一次成功监听后保存。保存后的端口由 watcher 继续使用，并在 Metro 退出后自动重启。

## Current Context

当前本地移动端脚本仍把 Metro 固定在 `8081`，并说明同一时间只跑一个 dev 环境。这个约定方便单个手动开发流程，但不适合多个 worktree 同时由人或 Claude 开发。

当前 E2E 设计不同。`pnpm e2e:ios` 使用 release build，JavaScript 已内嵌在 app 内，不连接 Metro。ADR-0007 明确不使用 dev-client + Metro，因为 dev-client 会显示开发菜单，且 `clearState` 会清除 dev-client 保存的 Metro 地址，使 Maestro 无法稳定进入 app 首页。

## Non-Goals

- 不把当前 release E2E 改成 dev-client + Metro。
- 不让 Metro 负责 agent server、Supabase 本地栈或数据库隔离。
- 不在 worktree 创建时无条件启动 Metro。
- 不停止与 Incipel 无关的进程，即使它占用了候选端口。

## Proposed Behavior

### First Metro Start

`pnpm dev:web`、`pnpm dev:ios`、`pnpm dev:android` 或 `pnpm dx metro up` 需要 Metro 时，先进入 `tools/incipel-dev` 的 Metro 管理流程。

如果当前 worktree 已保存 Metro 端口，先尝试使用该端口。

如果没有保存端口，或保存端口已经被与当前 worktree 无关的进程监听：

1. 根据 worktree realpath 生成一个候选端口。
2. 检查该端口是否已经监听。
3. 如果端口被占用，选择下一个候选端口。
4. 用最终候选端口启动 Metro。
5. 访问 `http://127.0.0.1:<port>/status`，确认 Metro 真在该端口上响应。
6. 只有确认成功后，才把端口写进 `.worktree-dev.env` 和 metadata。

这样端口记录只代表已经成功启动过的 Metro，而不是提前声明的愿望。

### Long-Running Metro

Metro 启动成功后，`tools/incipel-dev` 写入 metadata：

- `repoRoot`
- `mobileRoot`
- `port`
- `pid`
- `command`
- `mode`，例如 `web`、`ios-go`、`ios-devbuild`、`android-go`、`android-devbuild`
- `url`
- `statusUrl`
- `logPath`
- `updatedAt`

同时启动一个 Metro watcher。watcher 只属于当前 worktree，并负责：

- 定期检查 metadata 中的 PID 是否仍存在。
- 检查端口仍由当前 Metro 监听。
- 检查 `/status` 仍能返回成功响应。
- Metro 退出时，用保存端口重新启动。
- 如果保存端口已被无关进程占用，不停止该进程；选择新端口启动 Metro，并更新 `.worktree-dev.env` 与 metadata。

Metro 退出到 watcher 重启之间仍可能有短暂时间窗口。v1 接受这个窗口，不引入转发代理或 port keeper。

### Commands

Add these root-level commands:

```bash
pnpm dev:web
pnpm dx metro up
pnpm dx metro status --json
pnpm dx metro list --json
pnpm dx metro stop
```

`pnpm dev:web` is the default Claude entrypoint for mobile UI development. It runs:

1. `tools/incipel-dev env sync`
2. Metro start through `tools/incipel-dev`
3. `BROWSER=none EXPO_NO_TELEMETRY=1 npx expo start --web --localhost --port <port>` from `apps/mobile`

`pnpm dx metro up` starts or confirms the current worktree Metro without opening a browser or simulator.

`pnpm dx metro status --json` reports only the current worktree Metro.

`pnpm dx metro list --json` reports known Incipel Metro metadata and visible Incipel Expo processes.

`pnpm dx metro stop` stops only the current worktree Metro process after verifying ownership.

## Safety Rules

Metro stop must not trust PID alone. Before sending a signal, verify all of these:

- metadata `repoRoot` equals the current worktree realpath;
- process cwd belongs to the current worktree by longest git worktree root match;
- command looks like Expo Metro startup and includes the expected port;
- process is listening on metadata `port`;
- `statusUrl` responds successfully.

If any check fails, `metro stop` reports that it found no safe current worktree Metro to stop.

Metadata writes must use a temporary file followed by `rename`, so `status` and `list` never read partial JSON.

Port choice uses both operating-system listener checks and Incipel metadata. A lock file can reduce simultaneous Incipel starts from choosing the same candidate port, but the final authority is still whether Metro successfully listens and answers `/status`.

## Dev, Device, And E2E Boundaries

React Native Web development uses `pnpm dev:web`. This is the default path for Claude.

Expo Go and development build use the same current worktree Metro port, but they remain manual verification paths. iOS may still share `incipel-development`, so simulator app data and installed development build are not isolated by this design.

Current Maestro E2E remains release-build based and does not use Metro. E2E agent ports and simulator names may remain worktree-specific, but Metro watcher failure must not fail `pnpm e2e:ios`.

If the project later adds dev-client E2E, that must be a separate mode with its own design for developer menu behavior, `clearState`, saved Metro URL, and environment variables.

## Required Code Changes

- Add Metro lifecycle functions to `tools/incipel-dev/cli.mjs`.
- Add `dev:web` to root `package.json`.
- Update `scripts/dev-ios.sh` and `scripts/dev-android.sh` so they get Metro port from the Metro manager instead of a fixed `8081`.
- Keep `scripts/e2e-ios.sh` independent from Metro.
- Fix agent CORS registration before Web becomes the default Claude path: register CORS before agent routes and allow browser preflight for `/run` and `/logline`.
- Update `CLAUDE.md`, `docs/worktree-dev.md`, `apps/mobile/README.md`, and an ADR describing the new local Metro lifecycle.

## Testing

- `tools/incipel-dev/cli.test.mjs`
  - first successful Metro start saves the port;
  - candidate port occupied by an unrelated process chooses another port;
  - saved port is reused when it still belongs to the current worktree Metro;
  - stale PID does not allow stopping an unrelated process;
  - `metro list --json` distinguishes metadata entries and visible orphan Incipel Expo processes;
  - metadata writes are atomic.

- `scripts/dev-ios-target.test.sh`
  - iOS and Android scripts use `$EXPO_PORT` or the Metro manager output in deep links, status checks, `adb reverse`, and `expo start`;
  - scripts do not call `dx up` and do not start or check agent server;
  - E2E script still builds and runs release app without `expo start`.

- Agent tests
  - `OPTIONS /run` accepts browser preflight headers;
  - `OPTIONS /logline` accepts browser preflight headers;
  - existing native client routes still work.

- CI
  - run root script checks;
  - run `node --test tools/incipel-dev/cli.test.mjs`;
  - keep existing package typecheck and tests.
