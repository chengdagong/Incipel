# Worktree Metro Session Design

Status: approved for implementation planning
Date: 2026-06-25

## Goal

让 Claude 和开发者在任意 worktree 中都能按需启动一个 Metro server，完成当前开发或验证任务后关闭它。

v1 不维护常驻 Metro，不保存 Metro 进程状态，不提供 Metro watcher。每次需要 Metro 时现场选择空闲端口，并以前台进程运行。

## Current Context

当前本地移动端脚本仍把 Metro 固定在 `8081`，并说明同一时间只跑一个 dev 环境。这个约定方便单个手动开发流程，但不适合多个 worktree 同时由人或 Claude 开发。

当前 E2E 设计不同。`pnpm e2e:ios` 使用 release build，JavaScript 已内嵌在 app 内，不连接 Metro。ADR-0007 明确不使用 dev-client + Metro，因为 dev-client 会显示开发菜单，且 `clearState` 会清除 dev-client 保存的 Metro 地址，使 Maestro 无法稳定进入 app 首页。

## Non-Goals

- 不把当前 release E2E 改成 dev-client + Metro。
- 不让 Metro 负责 agent server、Supabase 本地栈或数据库隔离。
- 不在 worktree 创建时启动 Metro。
- 不维持 Metro 常驻，也不在 Metro 退出后自动重启。
- 不保存 Metro PID、日志路径或端口到 metadata。
- 不停止与 Incipel 无关的进程，即使它占用了候选端口。

## Proposed Behavior

### On-Demand Metro

`pnpm dev:web`、`pnpm dev:ios` 或 `pnpm dev:android` 需要 Metro 时，启动一个前台 Metro 进程。该进程随当前命令结束而退出。

启动流程：

1. 运行 `tools/incipel-dev env sync`，确保移动端 `.env` 与 agent env 已写好。
2. 从候选端口开始查找空闲端口。候选端口可以按 worktree realpath 派生，以减少不同 worktree 同时选择同一端口的概率。
3. 如果候选端口已被监听，选择下一个端口。
4. 用选定端口启动 Expo / Metro。
5. 访问 `http://127.0.0.1:<port>/status`，确认 Metro 已经在该端口响应。
6. 在命令输出中打印本次 URL。Claude 使用这个 URL 做浏览器验证。
7. 用户或 Claude 结束该前台命令时，Metro 退出。

端口是本次 Metro session 的运行参数，不是 worktree 的长期状态。

### Commands

Add these root-level commands:

```bash
pnpm dev:web
pnpm dev:ios -- --go
pnpm dev:ios -- --devbuild
pnpm dev:android -- --go
pnpm dev:android -- --devbuild
```

`pnpm dev:web` is the default Claude entrypoint for mobile UI development. It runs:

1. `tools/incipel-dev env sync`
2. port selection for this session
3. `BROWSER=none EXPO_NO_TELEMETRY=1 npx expo start --web --localhost --port <port>` from `apps/mobile`

`pnpm dev:ios` and `pnpm dev:android` keep their current role as manual verification commands. They use the session port for deep links and Android `adb reverse`, then keep the Metro process in the foreground.

No `dx metro status/list/stop` command is required in v1. If a future workflow needs background Metro, it should get a separate design.

## Safety Rules

Port selection must use the operating system as the authority:

- A port is usable only if no process is listening on it before start.
- After start, the command must confirm `http://127.0.0.1:<port>/status`.
- If Expo changes port or fails to start on the selected port, the wrapper treats that as startup failure and chooses another port.
- The wrapper must not stop a process that it did not start.

Because Metro runs in the foreground, process ownership is simple: the shell command that started Metro owns its lifetime. `Ctrl+C` or the tool runner ending the command is the stop mechanism.

## Dev, Device, And E2E Boundaries

React Native Web development uses `pnpm dev:web`. This is the default path for Claude.

Expo Go and development build use the same session port for the current command only. iOS may still share `incipel-development`, so simulator app data and installed development build are not isolated by this design.

Current Maestro E2E remains release-build based and does not use Metro. E2E agent ports and simulator names may remain worktree-specific, but Metro startup or shutdown must not affect `pnpm e2e:ios`.

If the project later adds dev-client E2E, that must be a separate mode with its own design for developer menu behavior, `clearState`, saved Metro URL, and environment variables.

## Required Code Changes

- Add `dev:web` to root `package.json`.
- Add a small port-selection helper to `tools/incipel-dev/cli.mjs` or a script under `scripts/lib/`.
- Update `scripts/dev-ios.sh` and `scripts/dev-android.sh` so they select a session port instead of using fixed `8081`.
- Keep `scripts/e2e-ios.sh` independent from Metro.
- Fix agent CORS registration before Web becomes the default Claude path: register CORS before agent routes and allow browser preflight for `/run` and `/logline`.
- Update `CLAUDE.md`, `docs/worktree-dev.md`, `apps/mobile/README.md`, and an ADR describing the on-demand Metro session model.

## Testing

- Port selection
  - chooses a free port when the first candidate is free;
  - skips a candidate port occupied by an unrelated process;
  - returns the actual selected port to the caller;
  - does not write long-lived Metro state.

- Web command
  - root `dev:web` exists;
  - web startup uses `BROWSER=none`, `EXPO_NO_TELEMETRY=1`, `--web`, `--localhost`, and the selected port;
  - startup waits for `/status` before printing the final URL.

- iOS and Android scripts
  - deep links, status checks, `adb reverse`, and `expo start` use the selected session port;
  - scripts do not call `dx up` and do not start or check agent server;
  - E2E script still builds and runs release app without `expo start`.

- Agent tests
  - `OPTIONS /run` accepts browser preflight headers;
  - `OPTIONS /logline` accepts browser preflight headers;
  - existing native client routes still work.

- CI
  - run root script checks;
  - run any `tools/incipel-dev` tests that cover port selection;
  - keep existing package typecheck and tests.

