# Mastra Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Current command note: later work changed mobile startup. `pnpm dev:ios` and `pnpm dev:android` now call `tools/incipel-dev env sync`, start Metro, and open the target simulator/device; they do not check, start, serve, or watch the agent. Daily development uses fixed agent port `4111`; E2E uses worktree-derived agent ports. Start the agent separately with `pnpm dev:agent`, or use `pnpm dx up` only when a background agent is needed.

**Goal:** Convert Incipel's agent backend from the current AI SDK on Supabase Edge Function runtime to a Mastra-backed Node agent server while preserving the existing AG-UI mobile contract and Supabase data layer.

**Architecture:** Keep `Screenplay`, AG-UI events, authentication, and Supabase persistence as Incipel-owned contracts. Replace the model/tool loop with a Mastra `Agent`, expose the existing Hono app from a Node server entry, and make local development point mobile clients at that Node server. Keep the old Supabase Edge Function files only as historical deployment artifacts until deployment is separately removed.

**Tech Stack:** TypeScript, Mastra `@mastra/core`, Hono, AG-UI, Supabase, Vitest, Node `tsx`.

---

## File Structure

- Modify `packages/agent/package.json`: add Mastra and Node server dependencies, remove direct AI SDK runtime dependencies no longer used by the agent package.
- Modify `packages/agent/src/model/provider.ts`: keep the small `ModelProvider` interface for `runTurnCore`, but make the default implementation Mastra-backed.
- Create `packages/agent/src/model/mastra.ts`: build Mastra agents, Mastra tools, and translate Mastra stream chunks into the existing `StreamChunk` shape.
- Delete `packages/agent/src/model/ai-sdk-runtime.ts` and `packages/agent/src/model/openrouter.ts`: remove the old direct AI SDK runtime.
- Modify `packages/agent/src/model/config.ts`: remove AI SDK provider types and return plain provider options for Mastra stream calls.
- Create `packages/agent/src/index.ts`: Node server entry for `createApp()`, with host/port environment variables.
- Modify `packages/agent/src/app.ts`: update comments and keep runtime behavior stable.
- Modify `packages/agent/src/logline.ts`: keep the public function but make it use the Mastra-backed provider through the existing factory.
- Modify `tools/incipel-dev/cli.mjs`: change local development from `supabase functions serve agent` to the Node agent server, use fixed daily dev agent port `4111`, keep worktree-derived agent ports for E2E, write `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:<port>`, and manage Node agent metadata.
- Modify `tools/incipel-dev/cli.test.mjs`: update tests to verify Node agent server metadata, health checks, env sync, stop behavior, and watcher restart behavior.
- Modify `supabase/functions/agent/index.ts` and `supabase/functions/agent/deno.json`: mark the Edge Function entry as deprecated for runtime use, without using it in local dev.
- Modify `README.md`, `apps/mobile/README.md`, `supabase/functions/README.md`, `docs/system-design.md`, `docs/worktree-dev.md`, `docs/adr/0002-agent-runtime-hono-edge-sse.md`, `docs/adr/0008-edge-only-agent-runtime.md`: document Mastra Node runtime and Supabase as data layer.
- Create `docs/adr/0011-mastra-node-agent-runtime.md`: record the runtime decision.
- Modify tests under `packages/agent/test/`: replace `ai-sdk-runtime.test.ts` with `mastra-runtime.test.ts`; update model adapter/config tests.

## Task 1: Dependencies and Mastra Runtime Tests

**Files:**
- Modify: `packages/agent/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/agent/test/mastra-runtime.test.ts`
- Modify: `packages/agent/test/model-adapters.test.ts`
- Modify: `packages/agent/test/model-config.test.ts`

- [ ] **Step 1: Add dependency test expectations**

Create `packages/agent/test/mastra-runtime.test.ts` with mocked `@mastra/core/agent` and `@mastra/core/tools`. The first tests must prove:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { StreamChunk } from '../src/model/provider';

const h = vi.hoisted(() => ({
  streamChunks: [] as any[],
  generatedText: '一句测试 logline',
  lastAgentConfig: null as any,
  lastStreamMessages: null as any,
  lastStreamOptions: null as any,
  createdTools: [] as any[],
}));

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: any) {
      h.lastAgentConfig = config;
    }
    async stream(messages: any, options: any) {
      h.lastStreamMessages = messages;
      h.lastStreamOptions = options;
      return {
        fullStream: (async function* () {
          for (const chunk of h.streamChunks) yield chunk;
        })(),
        text: Promise.resolve(h.generatedText),
      };
    }
  },
}));

vi.mock('@mastra/core/tools', () => ({
  createTool: (definition: any) => {
    h.createdTools.push(definition);
    return definition;
  },
}));

beforeEach(() => {
  h.streamChunks = [];
  h.generatedText = '一句测试 logline';
  h.lastAgentConfig = null;
  h.lastStreamMessages = null;
  h.lastStreamOptions = null;
  h.createdTools = [];
});

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @incipel/agent test -- test/mastra-runtime.test.ts
```

Expected: FAIL because `../src/model/mastra` does not exist.

- [ ] **Step 3: Install current stable dependencies**

Run:

```bash
pnpm --filter @incipel/agent add @mastra/core@1.45.0 @hono/node-server@2.0.6 zod@3.25.76
pnpm --filter @incipel/agent remove ai @openrouter/ai-sdk-provider
```

Expected: `packages/agent/package.json` and `pnpm-lock.yaml` change. `@ag-ui/core` remains unchanged. `zod` deliberately stays on the latest 3.x release instead of 4.x because this repository already uses Zod 3 APIs and Mastra supports `^3.25.0`.

- [ ] **Step 4: Implement `packages/agent/src/model/mastra.ts` minimally**

Implement `createMastraProvider(config)` returning `ModelProvider`. It must:

```ts
export function createMastraProvider(config: ModelRuntimeConfig = getModelConfig()): ModelProvider
```

The implementation must create one Mastra `Agent` per call, pass `model: "openrouter/<model>"` for OpenRouter, create Mastra tools from the provided Zod schemas, call `agent.stream(input.prompt, { system, maxSteps: 8, tools, toolChoice: 'auto', modelSettings: { temperature }, providerOptions })`, and translate Mastra chunks:

- `text-delta` with `payload.text` -> `{ type: 'text', delta }`
- `tool-call-input-streaming-start` -> `{ type: 'tool-call-start', toolCallId, toolName }`
- `tool-call` with `payload.toolCallId/toolName/args` -> `{ type: 'tool-call', call }`
- `error` -> throw the contained error
- all other chunks ignored

For `completeLogline`, call the Mastra agent with the logline model and return `await stream.text`.

- [ ] **Step 5: Run the Mastra runtime tests**

Run:

```bash
pnpm --filter @incipel/agent test -- test/mastra-runtime.test.ts
```

Expected: PASS.

## Task 2: Replace the Default Provider Factory

**Files:**
- Modify: `packages/agent/src/model/provider.ts`
- Modify: `packages/agent/src/model/config.ts`
- Delete: `packages/agent/src/model/ai-sdk-runtime.ts`
- Delete: `packages/agent/src/model/openrouter.ts`
- Modify: `packages/agent/test/model-adapters.test.ts`
- Modify: `packages/agent/test/model-config.test.ts`

- [ ] **Step 1: Write failing tests for the factory**

Update `packages/agent/test/model-adapters.test.ts` so it imports `createMastraProvider` instead of `createOpenRouterProvider`. Assert:

```ts
it('createMastraProvider 缺 OPENROUTER_API_KEY 时拒绝 OpenRouter', async () => {
  const { createMastraProvider } = await import('../src/model/mastra');
  expect(() => createMastraProvider()).toThrow(/OPENROUTER_API_KEY/);
});

it('createModelProvider 默认返回 Mastra-backed provider', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  const { createModelProvider } = await import('../src/model/provider');
  await expect(createModelProvider()).resolves.toMatchObject({
    streamTurn: expect.any(Function),
    completeLogline: expect.any(Function),
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
pnpm --filter @incipel/agent test -- model-adapters.test.ts model-config.test.ts
```

Expected: FAIL because the old factory still imports `openrouter.ts`.

- [ ] **Step 3: Change the factory and config**

Change `createModelProvider()` so:

- `MODEL_PROVIDER=stub` still imports `./stub.ts`.
- `MODEL_PROVIDER=openrouter` imports `./mastra.ts` and returns `createMastraProvider(config)`.
- unknown providers still throw.

Change `providerOptionsForUse()` to return `Record<string, unknown> | undefined` and remove imports from `ai` and `@openrouter/ai-sdk-provider`.

- [ ] **Step 4: Delete the old direct AI SDK files**

Delete:

```bash
packages/agent/src/model/ai-sdk-runtime.ts
packages/agent/src/model/openrouter.ts
packages/agent/test/ai-sdk-runtime.test.ts
```

- [ ] **Step 5: Run agent tests**

Run:

```bash
pnpm --filter @incipel/agent test
pnpm --filter @incipel/agent typecheck
```

Expected: PASS.

## Task 3: Node Server Entry for the Agent

**Files:**
- Create: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`
- Create: `packages/agent/test/node-server-entry.test.ts`

- [ ] **Step 1: Write a failing server entry test**

Create `packages/agent/test/node-server-entry.test.ts`. Mock `@hono/node-server` and assert that importing `src/index.ts` calls `serve()` with:

- `fetch: createApp().fetch`
- host from `HOST` or default `127.0.0.1`
- port from `PORT` or `AGENT_PORT`, default `4111`

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @incipel/agent test -- node-server-entry.test.ts
```

Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 3: Implement the Node entry**

Add `src/index.ts`:

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { env } from './env.ts';

const host = env('HOST') || '127.0.0.1';
const port = Number(env('AGENT_PORT') || env('PORT') || 4111);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`AGENT_PORT / PORT 必须是正整数,当前值: ${String(env('AGENT_PORT') || env('PORT'))}`);
}

serve({ fetch: createApp().fetch, hostname: host, port });
console.log(`[incipel-agent] Mastra agent server listening on http://${host}:${port}`);
```

Add script:

```json
"dev": "tsx watch src/index.ts",
"start": "tsx src/index.ts"
```

- [ ] **Step 4: Run the test and typecheck**

Run:

```bash
pnpm --filter @incipel/agent test -- node-server-entry.test.ts
pnpm --filter @incipel/agent typecheck
```

Expected: PASS.

## Task 4: Local Development CLI Uses Node Agent Server

**Files:**
- Modify: `tools/incipel-dev/cli.mjs`
- Modify: `tools/incipel-dev/cli.test.mjs`

- [ ] **Step 1: Update CLI tests first**

Change fixture expectations from `/functions/v1/agent` to the Node server base URL:

```text
EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:<agentPort>
```

Update fake health server to respond to `/health`. Update fake serve command to observe:

```bash
pnpm --filter @incipel/agent dev
```

Expected metadata command for foreground development:

```text
pnpm --filter @incipel/agent dev
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: FAIL because CLI still serves the Edge Function.

- [ ] **Step 3: Implement CLI changes**

Change `envSync(root)` to:

- keep `EXPO_PUBLIC_SUPABASE_URL` from the Supabase stack;
- use fixed daily dev `agentPort = 4111`; E2E stack setup still uses a worktree-derived agent port;
- set `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:${agentPort}`;
- write `AGENT_PORT=${agentPort}` into `supabase/.env` or a dedicated agent env file used by the process.

Change health check to call:

```text
http://127.0.0.1:<agentPort>/health
```

Change detached serve to:

```bash
pnpm --filter @incipel/agent start
```

with environment variables loaded from `supabase/.env`, plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and JWT settings already written by `envSync`.

Keep stop metadata semantics, but rename messages from "edge function" to "agent server".

- [ ] **Step 4: Run CLI tests**

Run:

```bash
node --test tools/incipel-dev/cli.test.mjs
```

Expected: PASS.

## Task 5: Runtime Contract Regression

**Files:**
- Modify: `packages/agent/test/run-orchestration.test.ts`
- Modify: `packages/agent/test/run-retry.test.ts`
- Modify: `packages/agent/test/stub-provider.test.ts`

- [ ] **Step 1: Run existing orchestration tests**

Run:

```bash
pnpm --filter @incipel/agent test -- run-orchestration.test.ts run-retry.test.ts stub-provider.test.ts save-turn-idempotency.test.ts
```

Expected: PASS. These tests prove Mastra adoption did not change the AG-UI event contract because `runTurnCore` still consumes the same provider interface.

- [ ] **Step 2: Add one integration assertion**

Add a test that `createModelProvider()` with `MODEL_PROVIDER=stub` still returns the deterministic provider and does not touch Mastra. This protects local E2E behavior.

- [ ] **Step 3: Run the focused tests again**

Run:

```bash
pnpm --filter @incipel/agent test -- model-adapters.test.ts stub-provider.test.ts
```

Expected: PASS.

## Task 6: Documentation and ADR Sync

**Files:**
- Create: `docs/adr/0011-mastra-node-agent-runtime.md`
- Modify: `README.md`
- Modify: `apps/mobile/README.md`
- Modify: `supabase/functions/README.md`
- Modify: `docs/system-design.md`
- Modify: `docs/worktree-dev.md`
- Modify: `docs/adr/0002-agent-runtime-hono-edge-sse.md`
- Modify: `docs/adr/0008-edge-only-agent-runtime.md`
- Modify: `supabase/functions/agent/index.ts`

- [ ] **Step 1: Write ADR-0011**

Record:

- Mastra Node agent server is the supported runtime.
- Supabase remains the data layer and authentication source.
- AG-UI remains the mobile UI protocol.
- Supabase Edge Function runtime is no longer the supported agent runtime.
- CopilotKit is not required for Expo mobile; it can be introduced later for Web surfaces.

- [ ] **Step 2: Update documentation references**

Replace statements that say "Edge Function is the only runtime" with "Mastra Node agent server is the runtime; Supabase remains the data layer." Where historical ADRs remain, mark them as superseded by ADR-0011.

- [ ] **Step 3: Run a phrase check**

Run:

```bash
rg -n "唯一运行时|Edge Function|functions/v1/agent|supabase functions serve agent|AI SDK|LangGraph|薄 agent" README.md docs apps/mobile/README.md supabase/functions packages/agent/src tools/incipel-dev
```

Expected: remaining matches are either historical context or explicitly marked as superseded/deprecated.

## Task 7: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Install and lock dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: PASS.

- [ ] **Step 2: Run all local TypeScript tests and type checks**

Run:

```bash
pnpm -r test
pnpm -r typecheck
node --test tools/incipel-dev/cli.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run static diff checks**

Run:

```bash
git diff --check
git status -sb
```

Expected: no whitespace errors; changed files match this plan.

- [ ] **Step 4: Manual health smoke when safe**

If no other local service uses the chosen port, run:

```bash
STORE=memory DEV_NO_AUTH=1 MODEL_PROVIDER=stub AGENT_PORT=4111 pnpm --filter @incipel/agent start
curl -s http://127.0.0.1:4111/health
```

Expected: `{"ok":true,"service":"incipel-agent"}`. Stop the process afterward.

## Self-Review

- Spec coverage: the plan covers Mastra runtime, AG-UI compatibility, Node server entry, local development changes, and documentation updates.
- Placeholder scan: no task uses TBD/TODO/fill-in wording as an implementation substitute.
- Type consistency: the plan keeps `ModelProvider` as the internal adapter boundary while replacing the default implementation with Mastra. This limits the migration risk while changing the actual runtime source.
