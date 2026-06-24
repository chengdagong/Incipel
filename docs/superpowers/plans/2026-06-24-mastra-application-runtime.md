# Mastra Application Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the agent runtime into a Mastra application that owns agents and server adapter initialization while preserving the Incipel AG-UI routes.

**Architecture:** Create a single Mastra application with registered `screenwriter` and `logline` agents. Register `/run`, `/logline`, and `/health` as Mastra custom API routes, then initialize a Hono app through `@mastra/hono` before starting the Node server.

**Tech Stack:** TypeScript, Mastra, `@mastra/hono`, Hono, AG-UI, Supabase, Vitest, Node test runner.

---

### Task 1: Dependencies

**Files:**
- Modify: `packages/agent/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Verify dependency versions**

Run:

```bash
npm view @mastra/core version
npm view @mastra/hono version peerDependencies --json
npm view hono version
```

Expected: `@mastra/core` is `1.46.0`, `@mastra/hono` is `1.5.1`, and `@mastra/hono` accepts Hono `^4.12.8`.

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm --filter @incipel/agent add @mastra/core@1.46.0 @mastra/hono@1.5.1 hono@^4.12.8
```

Expected: `packages/agent/package.json` and `pnpm-lock.yaml` update.

### Task 2: Failing Tests

**Files:**
- Modify: `packages/agent/test/node-server-entry.test.ts`
- Modify: `packages/agent/test/mastra-runtime.test.ts`

- [ ] **Step 1: Make Node entry test require MastraServer initialization**

Update the test mock so `@mastra/hono` exposes `MastraServer`, records constructor inputs, and records `init()` calls. Assert `serve()` receives the Hono app after `init()` completes.

- [ ] **Step 2: Make provider test require application registry lookup**

Mock the new application module and assert `createMastraProvider().streamTurn()` calls `mastra.getAgent('screenwriter')`; assert `completeLogline()` calls `mastra.getAgent('logline')`.

- [ ] **Step 3: Run tests and observe failure**

Run:

```bash
pnpm --filter @incipel/agent test -- node-server-entry.test.ts mastra-runtime.test.ts
```

Expected: tests fail because the entrypoint still imports `createApp()` directly and the provider still creates `Agent` instances directly.

### Task 3: Mastra Application

**Files:**
- Create: `packages/agent/src/mastra-app.ts`
- Create: `packages/agent/src/routes.ts`
- Modify: `packages/agent/src/app.ts`
- Modify: `packages/agent/src/model/mastra.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Extract custom API routes**

Move `/health`, `/run`, and `/logline` route handlers from `createApp()` into route definitions built with `registerApiRoute`. Preserve the body reading, authentication, store creation, and SSE behavior.

- [ ] **Step 2: Create Mastra application**

Create registered agents:

```ts
export const mastra = new Mastra({
  agents: {
    screenwriter: createAgent('incipel-screenwriter', 'Incipel Screenwriter', config.turn),
    logline: createAgent('incipel-logline', 'Incipel Logline', config.logline),
  },
  server: {
    apiRoutes: createAgentApiRoutes(),
  },
});
```

The actual implementation should accept an optional `ModelRuntimeConfig` so tests and the provider can build deterministic applications.

- [ ] **Step 3: Use registered agents in provider**

Change `createMastraProvider()` to retrieve agents from the Mastra application:

```ts
const agent = mastra.getAgent('screenwriter');
const loglineAgent = mastra.getAgent('logline');
```

Keep `clientTools`, model settings, provider options, and chunk translation behavior.

- [ ] **Step 4: Initialize MastraServer in Node entrypoint**

Create Hono, pass it to `new MastraServer({ app, mastra })`, await `server.init()`, then call `serve({ fetch: app.fetch, hostname, port })`.

### Task 4: Docs And Verification

**Files:**
- Modify: `docs/adr/0011-mastra-node-agent-runtime.md`
- Modify: `docs/system-design.md`
- Modify: `docs/mastra-agent-architecture-change.html`
- Modify if needed: `docs/worktree-dev.md`

- [ ] **Step 1: Update runtime description**

Replace “Mastra Node agent server + Hono” language with “Mastra application + Hono server adapter” where the architecture section describes ownership.

- [ ] **Step 2: Run verification**

Run:

```bash
pnpm test
pnpm typecheck
node --test tools/incipel-dev/cli.test.mjs
git diff --check
```

Expected: all commands exit 0.
