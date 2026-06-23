# Agent Edge Function Local Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm dev:ios` and `pnpm dev:android` serve and watch the current `worktree`'s `agent` Edge Function, and provide an explicit stop command for local cleanup.

**Architecture:** Extend `tools/incipel-dev/cli.mjs` without adding runtime dependencies. `up` will validate JSON metadata for the current `worktree`, compute source/env hashes, start a detached `supabase functions serve agent` process, and start a detached Node polling watcher. The watcher recomputes hashes for the `agent` inputs and restarts serving when the current `worktree` changes.

**Tech Stack:** Node.js built-ins (`fs`, `path`, `os`, `crypto`, `child_process`), Supabase CLI, Docker CLI, `node:test`, existing pnpm scripts.

---

## File Structure

- Modify `tools/incipel-dev/cli.mjs`: add agent metadata helpers, source snapshot hashing, current-`worktree` serve validation, detached watcher mode, restart logic, and `pnpm dx agent stop`.
- Modify `tools/incipel-dev/cli.test.mjs`: add CLI tests using temporary git repositories, fake `supabase` / `docker` commands, and temporary metadata files.
- Modify `CLAUDE.md`: document that dev scripts verify and watch the current `worktree`'s `agent`.
- Modify `docs/worktree-dev.md`: document watcher behavior, watched inputs, metadata/log locations, explicit stop command, and shared Edge Runtime restart effect.
- Modify `supabase/functions/README.md`: document source/env restart handling and `pnpm dx agent stop`.
- Keep `docs/superpowers/specs/2026-06-23-agent-edge-function-hot-reload-design.md` unchanged unless implementation discovers a design mismatch that must be recorded.

## Implementation Tasks

### Task 1: Metadata And Snapshot Helpers

**Files:**
- Modify: `tools/incipel-dev/cli.test.mjs`
- Modify: `tools/incipel-dev/cli.mjs`

- [x] **Step 1: Add failing tests for source snapshot and metadata mismatch**

Add tests near the existing `up dry-run restarts agent when env-file hash is missing despite healthy endpoint` test:

```js
test('up dry-run restarts agent when healthy serve metadata belongs to another worktree', async () => {
  // Build a temp repo with agent inputs and a healthy endpoint.
  // Write metadata whose repoRoot is `${tmp}-other`.
  // Run: node tools/incipel-dev/cli.mjs up --dry-run
  // Assert stdout says repo metadata does not match and prints a detached serve command.
});

test('up dry-run restarts agent when source hash changes despite healthy endpoint', async () => {
  // Build a temp repo with agent inputs and a healthy endpoint.
  // Write current-worktree serve metadata with stale sourceHash.
  // Run: node tools/incipel-dev/cli.mjs up --dry-run
  // Assert stdout says source changed and prints docker stop + detached serve command.
});
```

Use concrete fixture files in the temp repo:

```txt
supabase/config.toml
supabase/.env
supabase/functions/agent/index.ts
supabase/functions/agent/deno.json
packages/agent/src/app.ts
packages/agent/model.config.json
packages/shared/src/tools.ts
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: the two new tests fail because no JSON metadata helpers, source hashing, or current-`worktree` metadata validation exist.

- [x] **Step 3: Implement metadata paths and source/env snapshot helpers**

In `tools/incipel-dev/cli.mjs`, add helpers after `sha1Text`:

```js
const AGENT_FUNCTION = 'agent';

function agentPaths(root) {
  const token = worktreeHash(root);
  return {
    serveLog: join(tmpdir(), `incipel-agent-serve-${token}.log`),
    servePid: join(tmpdir(), `incipel-agent-serve-${token}.pid`),
    serveMeta: join(tmpdir(), `incipel-agent-serve-${token}.json`),
    watcherLog: join(tmpdir(), `incipel-agent-watcher-${token}.log`),
    watcherMeta: join(tmpdir(), `incipel-agent-watcher-${token}.json`),
  };
}
```

Add JSON helpers:

```js
function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
```

Add recursive file collection using only Node built-ins:

```js
function collectFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}
```

Import `readdirSync`, `statSync`, and `realpathSync` from `node:fs`, and `relative` from `node:path`.

Add snapshot calculation:

```js
function agentSourceFiles(root) {
  const files = [
    join(root, 'supabase', 'functions', AGENT_FUNCTION, 'index.ts'),
    join(root, 'supabase', 'functions', AGENT_FUNCTION, 'deno.json'),
    join(root, 'supabase', 'functions', AGENT_FUNCTION, 'deno.lock'),
    join(root, 'packages', 'agent', 'model.config.json'),
  ];
  collectFiles(join(root, 'packages', 'agent', 'src'), (file) => file.endsWith('.ts'), files);
  collectFiles(join(root, 'packages', 'shared', 'src'), (file) => file.endsWith('.ts'), files);
  return files.filter(existsSync).map((file) => relative(root, file)).sort();
}

function hashFiles(root, relativeFiles) {
  const h = createHash('sha1');
  for (const rel of relativeFiles) {
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(join(root, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

function agentSnapshot(root) {
  const sourceFiles = agentSourceFiles(root);
  const fnEnv = join(root, 'supabase', '.env');
  const envHash = existsSync(fnEnv) ? sha1Text(readFileSync(fnEnv, 'utf8')) : '';
  return {
    sourceFiles,
    sourceHash: hashFiles(root, sourceFiles),
    watchedPathsHash: sha1Text(sourceFiles.join('\n')),
    envHash,
  };
}
```

- [x] **Step 4: Use metadata in dry-run serve readiness**

Update `ensureAgentServe` to compute `paths = agentPaths(root)` and `snapshot = agentSnapshot(root)`. When `/health` is healthy, skip only if `readJson(paths.serveMeta)` has matching `repoRoot`, `functionName`, `sourceHash`, and `envHash`.

Dry-run output should include:

```txt
agent serve metadata does not match current worktree, restarting
agent source/env changed, restarting agent edge runtime
```

- [x] **Step 5: Run tests and verify GREEN**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: new metadata and source-hash tests pass, existing env-hash test still passes.

- [x] **Step 6: Commit Task 1**

```bash
git add tools/incipel-dev/cli.mjs tools/incipel-dev/cli.test.mjs
CODEX_DOCS_REVIEWED=1 git commit -m "feat(dev): validate agent serve metadata"
```

### Task 2: Current-Worktree Serve Metadata

**Files:**
- Modify: `tools/incipel-dev/cli.test.mjs`
- Modify: `tools/incipel-dev/cli.mjs`

- [ ] **Step 1: Add failing tests for written serve metadata**

Add a test with fake `supabase` and fake `docker` commands. The fake `supabase functions serve` script should stay alive long enough for the CLI to write metadata. The test should assert that `incipel-agent-serve-<hash>.json` contains:

```json
{
  "repoRoot": "<tmp repo>",
  "functionName": "agent",
  "command": "supabase functions serve agent --env-file supabase/.env --no-verify-jwt",
  "sourceHash": "<current source hash>",
  "envHash": "<current env hash>"
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: the metadata-file assertion fails because serve metadata is not written.

- [ ] **Step 3: Write serve metadata when starting detached serve**

After spawning detached `supabase functions serve`, write pending metadata:

```js
writeJson(paths.serveMeta, {
  repoRoot: root,
  functionName: AGENT_FUNCTION,
  pid: child.pid ?? null,
  command: `supabase ${serveArgs.join(' ')}`,
  logPath: paths.serveLog,
  sourceHash: snapshot.sourceHash,
  envHash: snapshot.envHash,
  watchedPathsHash: snapshot.watchedPathsHash,
  sourceFiles: snapshot.sourceFiles,
  status: 'pending',
  updatedAt: new Date().toISOString(),
});
```

When health check succeeds, update `status` to `ready`.

- [ ] **Step 4: Preserve existing PID compatibility**

Continue writing `paths.servePid` so existing manual `kill $(cat ...)` instructions still work during transition. Use the JSON metadata as the authoritative state for new logic.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: serve metadata is written and existing tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add tools/incipel-dev/cli.mjs tools/incipel-dev/cli.test.mjs
CODEX_DOCS_REVIEWED=1 git commit -m "feat(dev): record agent serve metadata"
```

### Task 3: Watcher Process And Restart Loop

**Files:**
- Modify: `tools/incipel-dev/cli.test.mjs`
- Modify: `tools/incipel-dev/cli.mjs`

- [ ] **Step 1: Add failing tests for watcher startup**

Add tests:

```js
test('up dry-run starts watcher when watcher metadata is missing', async () => {
  // Healthy endpoint + matching serve metadata.
  // No watcher metadata.
  // Run up --dry-run.
  // Assert stdout contains detached watcher command.
});

test('up dry-run restarts watcher when watcher metadata belongs to another worktree', async () => {
  // Healthy endpoint + matching serve metadata.
  // Watcher metadata repoRoot is another path.
  // Run up --dry-run.
  // Assert stdout says watcher metadata does not match and starts watcher.
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: watcher tests fail because no watcher command exists.

- [ ] **Step 3: Add hidden watcher command**

Add command routing:

```js
case 'agent':
  if (sub === 'stop') await stopAgent(root);
  else if (sub === 'watch') await watchAgent(root);
  else fail('用法: agent stop | agent watch');
  break;
```

Update the header help to mention public `agent stop`. Keep `agent watch` internal by documenting it in comments near the switch, not in user-facing docs.

- [ ] **Step 4: Add watcher metadata validation and startup**

Add `ensureAgentWatcher(root)`:

```js
async function ensureAgentWatcher(root) {
  const paths = agentPaths(root);
  const snapshot = agentSnapshot(root);
  const meta = readJson(paths.watcherMeta);
  if (meta?.repoRoot === root && meta?.functionName === AGENT_FUNCTION && meta?.watchedPathsHash === snapshot.watchedPathsHash && processAlive(meta.pid)) {
    log('  agent watcher 已在监控当前 worktree,跳过');
    return;
  }
  if (DRY) {
    log(`  [dry-run] detached: node tools/incipel-dev/cli.mjs agent watch`);
    log(`  [dry-run] watcher 日志 ${paths.watcherLog} / metadata ${paths.watcherMeta}`);
    return;
  }
  // Spawn process.execPath with [new URL(import.meta.url).pathname, 'agent', 'watch'].
}
```

- [ ] **Step 5: Wire watcher into `up`**

After `await ensureAgentServe(...)`, call:

```js
log('▸ 确保 agent watcher 在监控当前 worktree');
await ensureAgentWatcher(root);
```

- [ ] **Step 6: Implement polling watcher**

`watchAgent(root)` should:

1. Write watcher metadata with `repoRoot`, `functionName`, `pid`, `sourceFiles`, `watchedPathsHash`, and `logPath`.
2. Poll `agentSnapshot(root)` every 1000 ms.
3. When `sourceHash` or `envHash` changes, wait 300 ms and compute again.
4. If the recomputed hash still differs, log the changed state and call `restartAgentServe(root, snapshot)`.
5. Update watcher metadata after each successful snapshot.

Use polling rather than adding `chokidar`; this keeps `tools/incipel-dev` dependency-free and works in the current Node >=20 environment.

- [ ] **Step 7: Add focused watcher restart test**

Create a test that runs `node tools/incipel-dev/cli.mjs agent watch` in a temp repo with fake `supabase` / `docker` commands, changes `packages/agent/src/app.ts`, waits for fake command log output, and asserts only one restart after repeated saves.

- [ ] **Step 8: Add non-watched path test**

Run watcher, change `apps/mobile/src/ignored.ts` and `docs/ignored.md`, wait at least two polling intervals, and assert fake command log has no restart.

- [ ] **Step 9: Run tests and verify GREEN**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: watcher startup, watcher restart, and non-watched path tests pass.

- [ ] **Step 10: Commit Task 3**

```bash
git add tools/incipel-dev/cli.mjs tools/incipel-dev/cli.test.mjs
CODEX_DOCS_REVIEWED=1 git commit -m "feat(dev): watch agent source changes"
```

### Task 4: Explicit Stop Command

**Files:**
- Modify: `tools/incipel-dev/cli.test.mjs`
- Modify: `tools/incipel-dev/cli.mjs`

- [ ] **Step 1: Add failing stop-command tests**

Add tests:

```js
test('agent stop dry-run stops only current-worktree metadata processes', () => {
  // Write serve and watcher metadata with repoRoot = tmp.
  // Run: node tools/incipel-dev/cli.mjs agent stop --dry-run
  // Assert stdout contains kill lines for both PIDs and docker stop.
});

test('agent stop dry-run ignores metadata from another worktree', () => {
  // Write metadata with repoRoot = `${tmp}-other`.
  // Run stop --dry-run.
  // Assert stdout says nothing safe to stop and does not contain kill.
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: stop-command tests fail because `agent stop` does not exist.

- [ ] **Step 3: Implement process helpers**

Add:

```js
function processAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPid(pid, label) {
  if (DRY) {
    log(`  [dry-run] kill ${pid} (${label})`);
    return true;
  }
  // SIGTERM, wait up to 1500 ms, then SIGKILL if still alive.
}
```

- [ ] **Step 4: Implement `stopAgent(root)`**

`stopAgent` should:

1. Read `agentPaths(root).watcherMeta` and `agentPaths(root).serveMeta`.
2. Stop only metadata whose `repoRoot === root`.
3. Stop watcher first, then serve.
4. Stop the Edge Runtime container only if it stopped or would stop a current-worktree serve process.
5. Print log paths and metadata paths.
6. If nothing matches, print `没有可安全停止的当前 worktree agent 进程`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: stop-command tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add tools/incipel-dev/cli.mjs tools/incipel-dev/cli.test.mjs
CODEX_DOCS_REVIEWED=1 git commit -m "feat(dev): add explicit agent stop command"
```

### Task 5: Documentation Updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/worktree-dev.md`
- Modify: `supabase/functions/README.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Change the `pnpm dev:ios` / `pnpm dev:android` bullets to say that `up` confirms the current `worktree`'s `agent` is being served and watched. Add `pnpm dx agent stop` as the explicit cleanup command.

- [ ] **Step 2: Update `docs/worktree-dev.md`**

In the Agent section, describe:

- `up` validates `repoRoot` metadata before reusing a healthy endpoint.
- watched inputs are `supabase/functions/agent`, `packages/agent/src`, `packages/agent/model.config.json`, `packages/shared/src`, and `supabase/.env`.
- metadata/log files live under `os.tmpdir()` with `incipel-agent-serve-<hash>` and `incipel-agent-watcher-<hash>` names.
- `Ctrl+C` in Metro does not stop background agent processes.
- `pnpm dx agent stop` stops current-`worktree` watcher/serve processes and leaves local Supabase database/auth/storage running.
- stopping Edge Runtime affects the shared local function service.

- [ ] **Step 3: Update `supabase/functions/README.md`**

Update the local run section to explain that `pnpm dx up` handles env and source changes for `agent`, and add:

```bash
pnpm dx agent stop
```

as the explicit cleanup command.

- [ ] **Step 4: Run text checks**

Run:

```bash
bash /Users/chengdagong/.claude/skills/plain-chinese/scripts/lint-jargon.sh CLAUDE.md docs/worktree-dev.md supabase/functions/README.md
```

Expected: no unsuitable Chinese expressions remain, or any reported line is a literal command / existing project term that should stay.

- [ ] **Step 5: Commit Task 5**

```bash
git add CLAUDE.md docs/worktree-dev.md supabase/functions/README.md
CODEX_DOCS_REVIEWED=1 git commit -m "docs(dev): document agent watcher lifecycle"
```

### Task 6: Final Verification

**Files:**
- Verify only; no planned edits unless tests reveal a defect.

- [ ] **Step 1: Run focused CLI tests**

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: all CLI tests pass.

- [ ] **Step 2: Run monorepo tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: all packages pass type checking.

- [ ] **Step 4: Run diff checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional files are modified before the final commit.

- [ ] **Step 5: Final commit if needed**

If verification required small fixes after earlier commits:

```bash
git add tools/incipel-dev/cli.mjs tools/incipel-dev/cli.test.mjs CLAUDE.md docs/worktree-dev.md supabase/functions/README.md docs/superpowers/plans/2026-06-23-agent-edge-function-hot-reload.md
CODEX_DOCS_REVIEWED=1 git commit -m "test(dev): verify agent watcher workflow"
```

## Self-Review

- Spec coverage: current-`worktree` serve validation, watcher validation, source/env hashing, active watching, restart behavior, explicit stop command, tests, docs, and isolated `worktree` implementation are covered.
- Scope check: the plan only modifies local developer tooling and related docs for the existing `agent` function. It does not add multi-function management, Node agent runtime, database migrations, or mobile app behavior.
- TDD check: each behavior change starts with failing tests before implementation.
- Dependency check: no new package version is introduced; the watcher uses Node built-ins.
