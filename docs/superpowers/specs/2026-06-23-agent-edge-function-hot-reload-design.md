# Agent Edge Function local reload design

Status: approved for implementation planning
Date: 2026-06-23
Branch: `codex/agent-edge-hot-reload`
Worktree: `/Users/chengdagong/Documents/Projects/Incipel/.worktrees/agent-edge-hot-reload`

## Context

`pnpm dev:ios` and `pnpm dev:android` call `tools/incipel-dev up` before starting Metro. Today `up` confirms that the shared local Supabase stack is running, syncs `apps/mobile/.env` and `supabase/.env`, then checks `/functions/v1/agent/health`.

That health check proves that some local `agent` function can respond. It does not prove that the running function belongs to the current Git `worktree`, or that it has re-read files changed after `up` started. The current code also restarts the local Edge Runtime when `supabase/.env` changes at startup, but it does not actively monitor source files after startup.

The project currently has one Edge Function, `supabase/functions/agent`. This design only covers that function.

## Goals

- `pnpm dev:ios` and `pnpm dev:android` must confirm that the served `agent` function belongs to the current `worktree`.
- The file watcher must also belong to the current `worktree` and monitor paths under that same `worktree`.
- After files that affect `agent` change, the next local request should use the current source and environment variables.
- Existing commands should remain the entry points: `pnpm dev:ios`, `pnpm dev:android`, `pnpm dev:agent`, and `pnpm dx up`.
- The implementation must be done in the isolated branch and `worktree` listed at the top of this document.

## Non-goals

- Do not build generic multi-function management for every future directory under `supabase/functions/*`.
- Do not add a Node runtime for the agent.
- Do not run database migrations, reset the local database, or change Supabase schema as part of file watching.
- Do not watch mobile app files, documentation, tests, or migration files for agent restarts.

## Proposed design

`tools/incipel-dev up` will continue to be the single preparation step used by mobile development scripts. After stack and env sync, `up` confirms two local background processes:

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

- `CLAUDE.md`: `pnpm dev:ios` and `pnpm dev:android` confirm that the current `worktree`'s `agent` is being served and watched.
- `docs/worktree-dev.md`: describe watcher responsibility, watched paths, metadata and log locations, and the shared Edge Runtime restart effect.
- `supabase/functions/README.md`: explain that local `up` handles both env changes and source changes for `agent`.

## Implementation constraint

Implementation must continue in `codex/agent-edge-hot-reload` under `/Users/chengdagong/Documents/Projects/Incipel/.worktrees/agent-edge-hot-reload`. Do not implement this feature in the original `/Users/chengdagong/Documents/Projects/Incipel` checkout.
