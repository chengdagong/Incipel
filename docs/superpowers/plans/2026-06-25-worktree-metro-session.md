# Worktree Metro Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed Metro port usage with an on-demand per-command Metro session port for web, iOS, and Android development.

**Architecture:** Keep Metro process ownership in the foreground command. Add a small `tools/incipel-dev` port helper that selects an available port without writing Metro state, then have `dev:web`, `dev:ios`, and `dev:android` pass that selected port to Expo, status checks, deep links, and Android `adb reverse`.

**Tech Stack:** pnpm scripts, Bash, Node.js `node:test`, Expo CLI, Hono CORS middleware, Vitest.

## Global Constraints

- v1 does not maintain background Metro processes.
- v1 does not persist Metro PID, log path, selected port, or other Metro process metadata.
- v1 does not add `dx metro status`, `dx metro list`, or `dx metro stop`.
- Metro startup must use an operating-system listener check as the source of truth for port availability.
- `pnpm e2e:ios` remains release-build based and must not start Metro.
- CORS must be registered before agent routes so browser preflight requests for `/run` and `/logline` succeed.
- Use TDD: add failing tests first, verify failure, implement, then verify passing tests.

---

## File Structure

- `tools/incipel-dev/cli.mjs`: add reusable port selection and the `metro port` and `web` commands.
- `tools/incipel-dev/cli.test.mjs`: cover port selection, occupied-port skipping, and absence of long-lived Metro state.
- `package.json`: add root `dev:web`.
- `.github/workflows/ci.yml`: run root script checks and `tools/incipel-dev` tests.
- `scripts/lib/worktree-dev-env.sh`: remove fixed `EXPO_PORT=8081` from worktree env ownership.
- `scripts/dev-ios.sh`: select a session Metro port and use it for status checks, deep links, and Expo.
- `scripts/dev-android.sh`: select a session Metro port and use it for `adb reverse`, status checks, deep links, and Expo.
- `scripts/dev-ios-target.test.sh`: add static checks for root `dev:web` and selected session port usage.
- `packages/agent/src/index.ts`: register CORS before agent routes and allow browser preflight for `/run` and `/logline`.
- `packages/agent/test/node-server-entry.test.ts`: add preflight tests for `/run` and `/logline`.
- `CLAUDE.md`, `docs/worktree-dev.md`, `apps/mobile/README.md`: document the on-demand Metro session workflow.
- `docs/adr/0012-worktree-metro-session.md`: record the decision.

## Task 1: Script And CLI Failing Tests

**Files:**
- Modify: `scripts/dev-ios-target.test.sh`
- Modify: `tools/incipel-dev/cli.test.mjs`

**Interfaces:**
- Produces expected CLI behavior for `node tools/incipel-dev/cli.mjs metro port`.
- Produces static script expectations for the selected session port variable.

- [ ] **Step 1: Add failing script checks**

Update `scripts/dev-ios-target.test.sh` so it expects:

```bash
require_contains package.json '"dev:web": "node tools/incipel-dev/cli.mjs web"'
require_not_contains scripts/lib/worktree-dev-env.sh 'EXPO_PORT=8081'
require_contains scripts/dev-ios.sh 'METRO_PORT="$(node "$REPO_ROOT/tools/incipel-dev/cli.mjs" metro port)"'
require_contains scripts/dev-android.sh 'METRO_PORT="$(node "$REPO_ROOT/tools/incipel-dev/cli.mjs" metro port)"'
require_contains scripts/dev-android.sh 'adb -s "$ANDROID_SERIAL" reverse tcp:"$METRO_PORT" tcp:"$METRO_PORT"'
require_not_contains scripts/e2e-ios.sh 'expo start'
```

- [ ] **Step 2: Add failing CLI tests**

Add `node:test` coverage in `tools/incipel-dev/cli.test.mjs`:

```js
test('metro port returns an available port without writing state', async () => {
  const fixture = await writeAgentFixture(t);
  const root = fixture.root;
  const result = await runCli(['metro', 'port'], {
    cwd: root,
    env: { INCIPEL_METRO_PORT_BASE: '19081', INCIPEL_METRO_PORT_RANGE: '20' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+$/);
  assert.equal(existsSync(join(root, '.worktree-metro.json')), false);
  assert.equal(existsSync(join(root, '.metro-session.json')), false);
});

test('metro port skips an occupied candidate port', async () => {
  const fixture = await writeAgentFixture(t);
  const blocker = createServer();
  await listen(blocker, 19082);
  t.after(() => blocker.close());
  const result = await runCli(['metro', 'port'], {
    cwd: fixture.root,
    env: {
      INCIPEL_METRO_PORT_BASE: '19082',
      INCIPEL_METRO_PORT_RANGE: '3',
      INCIPEL_METRO_PORT_HASH: '0',
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '19083');
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
bash scripts/dev-ios-target.test.sh
node --test tools/incipel-dev/cli.test.mjs
```

Expected: both fail because `dev:web`, `metro port`, and selected session port usage do not exist yet.

## Task 2: Implement Port Selection And Dev Commands

**Files:**
- Modify: `tools/incipel-dev/cli.mjs`
- Modify: `package.json`
- Modify: `scripts/lib/worktree-dev-env.sh`
- Modify: `scripts/dev-ios.sh`
- Modify: `scripts/dev-android.sh`

**Interfaces:**
- Produces `selectMetroPort(root: string): Promise<number>`.
- Produces `metro port` CLI command that prints only the selected port.
- Produces `web` CLI command used by root `pnpm dev:web`.

- [ ] **Step 1: Implement port helper**

Add a helper that:

```js
const METRO_PORT_BASE = 8081;
const METRO_PORT_RANGE = 1000;
async function selectMetroPort(root = repoRoot()) {
  const realRoot = await realpath(root);
  const base = Number(process.env.INCIPEL_METRO_PORT_BASE || METRO_PORT_BASE);
  const range = Number(process.env.INCIPEL_METRO_PORT_RANGE || METRO_PORT_RANGE);
  const hash = Number(process.env.INCIPEL_METRO_PORT_HASH || hashString(realRoot));
  for (let offset = 0; offset < range; offset += 1) {
    const port = base + ((hash + offset) % range);
    if (await portAvailable(port)) return port;
  }
  throw new Error(`No available Metro port in ${base}-${base + range - 1}`);
}
```

- [ ] **Step 2: Add CLI commands**

Add:

```js
case 'metro':
  if (sub === 'port') {
    console.log(String(await selectMetroPort(root)));
    break;
  }
  usage(1);
  break;
case 'web':
  await envSync(root);
  await runWeb(root);
  break;
```

`runWeb(root)` must pass `BROWSER=none`, `EXPO_NO_TELEMETRY=1`, `--web`, `--localhost`, and `--port <selected port>` to Expo from `apps/mobile`.

- [ ] **Step 3: Update shell scripts**

Remove fixed `EXPO_PORT=8081` ownership from `scripts/lib/worktree-dev-env.sh`. In `scripts/dev-ios.sh` and `scripts/dev-android.sh`, set:

```bash
METRO_PORT="$(node "$REPO_ROOT/tools/incipel-dev/cli.mjs" metro port)"
```

Use `$METRO_PORT` for `/status`, deep links, Android `adb reverse`, and `npx expo start --port`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bash scripts/dev-ios-target.test.sh
node --test tools/incipel-dev/cli.test.mjs
```

Expected: both pass.

## Task 3: Agent CORS Failing Tests And Fix

**Files:**
- Modify: `packages/agent/test/node-server-entry.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces browser preflight responses for `/run` and `/logline` before route handlers run.

- [ ] **Step 1: Add failing preflight tests**

Add tests that send:

```ts
await app.request('/run', {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://127.0.0.1:19081',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type, authorization',
  },
});
```

Repeat the same request for `/logline`, and assert status `204`, `access-control-allow-origin`, `access-control-allow-methods`, and `access-control-allow-headers`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @incipel/agent test -- node-server-entry.test.ts
```

Expected: FAIL because CORS is currently registered after agent routes.

- [ ] **Step 3: Register CORS before routes**

Move `app.use('*', cors(...))` before `registerAgentHonoRoutes(app)` and include POST preflight headers:

```ts
allowMethods: ['GET', 'POST', 'OPTIONS'],
allowHeaders: ['Content-Type', 'Authorization'],
credentials: true,
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @incipel/agent test -- node-server-entry.test.ts
```

Expected: PASS.

## Task 4: Documentation And CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`
- Modify: `docs/worktree-dev.md`
- Modify: `apps/mobile/README.md`
- Create: `docs/adr/0012-worktree-metro-session.md`

**Interfaces:**
- Produces a documented default mobile UI workflow: `pnpm dev:web`.
- Produces CI coverage for root script checks and `tools/incipel-dev` tests.

- [ ] **Step 1: Update CI**

Add:

```yaml
- run: bash scripts/dev-ios-target.test.sh
- run: node --test tools/incipel-dev/cli.test.mjs
```

to the existing typecheck-and-test job.

- [ ] **Step 2: Update docs**

Document that:

```text
pnpm dev:web
pnpm dev:ios -- --go
pnpm dev:ios -- --devbuild
pnpm dev:android -- --go
pnpm dev:android -- --devbuild
```

choose an available Metro port for the current command only. State that E2E remains release-build based and does not start Metro.

- [ ] **Step 3: Add ADR**

Create `docs/adr/0012-worktree-metro-session.md` with the decision, rejected background process model, and consequences for parallel worktrees.

- [ ] **Step 4: Verify docs and CI changes**

Run:

```bash
git diff --check
rg -n 'Metro 固定|EXPO_PORT=8081|dev 环境' CLAUDE.md docs/worktree-dev.md apps/mobile/README.md scripts
```

Expected: no stale fixed-8081 guidance remains outside historical ADR text or comments explaining release E2E.

## Task 5: Final Verification

**Files:**
- All files touched above.

**Interfaces:**
- Produces the complete behavior from the approved design.

- [ ] **Step 1: Run focused checks**

Run:

```bash
bash scripts/dev-ios-target.test.sh
node --test tools/incipel-dev/cli.test.mjs
pnpm --filter @incipel/agent test -- node-server-entry.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run package checks required by CI**

Run:

```bash
pnpm -r typecheck
pnpm -r test
```

Expected: all pass.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff --check
```

Expected: only intended files are changed and whitespace checks pass.

## Self-Review

- The plan covers port selection, web command, iOS and Android scripts, CORS, documentation, ADR, and CI.
- The plan avoids background Metro lifecycle management, persistent Metro metadata, and Metro stop/list/status commands.
- The implementation keeps E2E independent from Metro.
