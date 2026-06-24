# Agent Edge Function local reload design

Status: approved for implementation planning
Date: 2026-06-23
Branch: `codex/agent-edge-hot-reload`
Worktree: `/Users/chengdagong/Documents/Projects/Incipel/.worktrees/agent-edge-hot-reload`

> Historical note: this design has been superseded by the Mastra Node agent runtime and the later mobile startup change. The current command behavior is: `pnpm dev:ios` and `pnpm dev:android` call `tools/incipel-dev env sync`, start Metro, and open the target simulator/device; they do not check, start, serve, or watch the agent. Start the agent separately with `pnpm dev:agent`, or use `pnpm dx up` only when a background agent is needed.

## Context

At the time this design was written, `pnpm dev:ios` and `pnpm dev:android` called `tools/incipel-dev up` before starting Metro. That is no longer the current behavior.

That health check proves that some local `agent` function can respond. It does not prove that the running function belongs to the current Git `worktree`, or that it has re-read files changed after `up` started. The current code also restarts the local Edge Runtime when `supabase/.env` changes at startup, but it does not actively monitor source files after startup.

The project currently has one Edge Function, `supabase/functions/agent`. This design only covers that function.

## Goals

- Historical requirement: `pnpm dev:ios` and `pnpm dev:android` were expected to confirm that the served `agent` function belonged to the current `worktree`. Current mobile development scripts do not manage the agent.
- The file watcher must also belong to the current `worktree` and monitor paths under that same `worktree`.
- After files that affect `agent` change, the next local request should use the current source and environment variables.
- Existing commands should remain the entry points: `pnpm dev:ios`, `pnpm dev:android`, `pnpm dev:agent`, and `pnpm dx up`.
- `Ctrl+C` in Metro should not be required to clean up agent background processes, but there must be an explicit stop command for local cleanup.
- The implementation must be done in the isolated branch and `worktree` listed at the top of this document.

## Non-goals

- Do not build generic multi-function management for every future directory under `supabase/functions/*`.
- Do not add a Node runtime for the agent.
- Do not run database migrations, reset the local database, or change Supabase schema as part of file watching.
- Do not watch mobile app files, documentation, tests, or migration files for agent restarts.

## Proposed design

`tools/incipel-dev up` was intended to be the single preparation step used by mobile development scripts. Current mobile development scripts use `tools/incipel-dev env sync` instead. When `up` is run manually, it confirms two local background processes:

- `agent serve`: the detached `supabase functions serve agent --env-file supabase/.env --no-verify-jwt` process.
- `agent watcher`: a detached Node process owned by `tools/incipel-dev` that watches files affecting the `agent` function and restarts `agent serve` when their content changes.

Both processes write metadata files under `os.tmpdir()`. Metadata must include at least:

- `repoRoot`
- `functionName`
- `pid`
- `command`
- `logPath`
- the hash of watched source files
- the hash of `supabase/.env`
- for watcher metadata, the watched path list and its hash

`up` must not treat a healthy `/functions/v1/agent/health` response as sufficient. It may skip restart only when all of these are true:

- the health check succeeds;
- `agent serve` metadata exists;
- `agent serve` metadata has `repoRoot` equal to the current `worktree` root;
- stored source and env hashes match current files;
- `agent watcher` metadata exists;
- watcher metadata has `repoRoot` equal to the current `worktree` root;
- watcher metadata describes the current watched path list.

If any condition fails, `up` stops stale local processes it owns and starts fresh ones from the current `worktree`.

## Watched inputs

The watcher should monitor only files that can change the local `agent` function behavior:

- `supabase/functions/agent/index.ts`
- `supabase/functions/agent/deno.json`
- `supabase/functions/agent/deno.lock`, if present
- `packages/agent/src/**/*.ts`
- `packages/agent/model.config.json`
- `packages/shared/src/**/*.ts`
- `supabase/.env`

On add, change, or remove events, the watcher briefly waits to combine repeated save events, then recomputes hashes. If hashes do not change, it does nothing. If source or env hashes change, it restarts local serving for `agent`.

## Restart behavior

Stopping must be narrow:

- Stop only PIDs recorded in metadata owned by the current `worktree`.
- Confirm `repoRoot` before sending signals.
- Send `SIGTERM` first and wait briefly.
- If the process still exists, send `SIGKILL`.
- Do not stop processes by broad process-name matching.

Restart sequence:

1. Stop the current `worktree`'s old `agent serve` process.
2. Stop the local Edge Runtime container for the shared Supabase project, as the current code already does.
3. Start `supabase functions serve agent --env-file supabase/.env --no-verify-jwt` from the current `worktree` root.
4. Poll `/functions/v1/agent/health`.
5. On success, write fresh metadata.
6. On failure, leave the log path and failure state visible so the next `up` or file change can retry.

Stopping the Edge Runtime container affects the shared local Supabase stack. That is acceptable for this project because daily development already assumes one active dev environment. The command output and docs must state this clearly.

## Explicit stop command

`agent serve` and `agent watcher` are background processes. They should not automatically exit when the user presses `Ctrl+C` in Metro. Keeping them running preserves the current development behavior: the local Supabase stack and served agent remain ready for the next mobile start.

Add an explicit stop command:

```bash
pnpm dx agent stop
```

This command should:

1. Read current `worktree` metadata.
2. Stop only the `agent watcher` and `agent serve` PIDs whose metadata has `repoRoot` equal to the current `worktree` root.
3. Use `SIGTERM`, then `SIGKILL` if the process does not exit.
4. Stop the local Edge Runtime container only when it is stopping a serve process owned by the current `worktree`.
5. Print the affected PID and log paths.
6. Leave the local Supabase database, auth, storage, and other stack containers running.

If metadata is missing or belongs to another `worktree`, the command should report that it has nothing safe to stop. It must not stop processes by broad process-name matching.

## Failure handling

- If `supabase functions serve` exits immediately, `up` should fail with the log path instead of starting Metro against an unavailable agent.
- If health checking times out while the serve process still exists, keep the current permissive behavior: report that startup may still be compiling, keep the process running, and mark metadata as pending.
- If the watcher exits, the next `up` must detect the missing or stale PID and restart the watcher.
- If watcher-triggered restart fails, keep Metro running, write the error to the watcher log, and retry on the next relevant file change or `up`.

## Test plan

Add tests in `tools/incipel-dev/cli.test.mjs` using temporary directories and fake `supabase` commands:

- A healthy endpoint with serve metadata from another `worktree` causes a restart from the current `worktree`.
- A source hash change causes `agent serve` and the Edge Runtime container to restart.
- Missing watcher metadata, a dead watcher PID, or watcher metadata from another `worktree` causes watcher restart.
- Changing `packages/agent/src/app.ts` or `packages/shared/src/tools.ts` triggers one restart after repeated save events are combined.
- Changing `apps/mobile`, docs, tests, or migration files does not restart `agent`.
- `pnpm dx agent stop` stops only watcher and serve processes whose metadata belongs to the current `worktree`.
- `pnpm dx agent stop` does not stop processes when metadata is missing or points at another `worktree`.
- `--dry-run` reports planned serve and watcher actions without writing PID or metadata files and without starting processes.

Run these checks:

```bash
node --test tools/incipel-dev/cli.test.mjs
pnpm test
```

Baseline before this design document was written:

```bash
pnpm install --frozen-lockfile
pnpm test
```

Both passed in the isolated `worktree`.

## Documentation updates

Update these documents during implementation:

- `CLAUDE.md`: current docs must say that `pnpm dev:ios` and `pnpm dev:android` do not start or check the agent. Agent startup is separate: `pnpm dev:agent` for foreground, `pnpm dx up` for background.
- `docs/worktree-dev.md`: describe watcher responsibility, watched paths, metadata and log locations, the explicit stop command, and the shared Edge Runtime restart effect.
- `supabase/functions/README.md`: explain that local `up` handles both env changes and source changes for `agent`, and that `pnpm dx agent stop` performs explicit cleanup.

## Implementation constraint

Implementation must continue in `codex/agent-edge-hot-reload` under `/Users/chengdagong/Documents/Projects/Incipel/.worktrees/agent-edge-hot-reload`. Do not implement this feature in the original `/Users/chengdagong/Documents/Projects/Incipel` checkout.
