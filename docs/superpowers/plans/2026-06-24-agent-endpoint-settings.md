# Agent Endpoint Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a development-only setting for overriding the mobile app's agent server base URL.

**Architecture:** Put URL normalization, storage, release visibility, and effective URL state in `apps/mobile/src/agentEndpoint.tsx`. The settings screen edits that module through a React provider, while AG-UI endpoint helpers read the module's current effective base URL. Release builds hide the UI, but still use the build-time `EXPO_PUBLIC_AGENT_URL`.

**Tech Stack:** Expo Router, React Native, Expo Constants, AsyncStorage, Vitest.

## Global Constraints

- The setting is shown only in Expo Go and development build.
- The setting is hidden in release builds.
- Accept both full URLs and host plus port input.
- Do not store secrets in mobile settings.
- Keep `EXPO_PUBLIC_AGENT_URL` as the default value.
- Use TDD: write a failing test, verify it fails, implement, verify it passes.

---

## File Structure

- `apps/mobile/src/agentEndpoint.tsx`: owns normalization, `AsyncStorage` persistence, release/development visibility, and endpoint construction.
- `apps/mobile/src/agentEndpoint.test.ts`: verifies the behavior without rendering React Native UI.
- `apps/mobile/src/agui/client.ts`: consumes `runEndpoint()` and `loglineEndpoint()` from `agentEndpoint.tsx`.
- `apps/mobile/app/_layout.tsx`: installs `AgentEndpointProvider` so the stored override is loaded early.
- `apps/mobile/app/(app)/settings.tsx`: renders a development-only input, save action, reset action, and current URL text.
- `apps/mobile/src/i18n.tsx`: provides labels and messages in all four UI languages.
- `apps/mobile/.env.example`, `docs/worktree-dev.md`, `docs/adr/0011-mastra-node-agent-runtime.md`: update public configuration notes.

## Task 1: Agent Endpoint Module

**Files:**
- Create: `apps/mobile/src/agentEndpoint.tsx`
- Create: `apps/mobile/src/agentEndpoint.test.ts`

**Interfaces:**
- Produces: `normalizeAgentBaseUrlInput(raw: string): AgentEndpointParseResult`
- Produces: `runEndpoint(): string`
- Produces: `loglineEndpoint(): string`
- Produces: `isAgentEndpointSettingsVisible(constants?: ConstantsLike): boolean`
- Produces: `AgentEndpointProvider({ children }: { children: React.ReactNode })`
- Produces: `useAgentEndpointSettings(): AgentEndpointSettings`

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/src/agentEndpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAgentEndpoint,
  isAgentEndpointSettingsVisible,
  normalizeAgentBaseUrlInput,
} from './agentEndpoint';

describe('normalizeAgentBaseUrlInput', () => {
  it('accepts host plus port and uses http', () => {
    expect(normalizeAgentBaseUrlInput('192.168.1.23:4111')).toEqual({
      ok: true,
      value: 'http://192.168.1.23:4111',
    });
  });

  it('accepts full https URLs and strips trailing slash', () => {
    expect(normalizeAgentBaseUrlInput(' https://agent.example.com/ ')).toEqual({
      ok: true,
      value: 'https://agent.example.com',
    });
  });

  it('rejects unsupported protocols', () => {
    expect(normalizeAgentBaseUrlInput('ftp://agent.example.com')).toEqual({
      ok: false,
      reason: 'protocol',
    });
  });
});

describe('buildAgentEndpoint', () => {
  it('appends endpoint paths after a stored base path', () => {
    expect(buildAgentEndpoint('https://agent.example.com/api', 'run')).toBe('https://agent.example.com/api/run');
    expect(buildAgentEndpoint('https://agent.example.com/api/', 'logline')).toBe('https://agent.example.com/api/logline');
  });
});

describe('isAgentEndpointSettingsVisible', () => {
  it('shows in Expo Go and development client', () => {
    expect(isAgentEndpointSettingsVisible({ executionEnvironment: 'storeClient', appOwnership: null })).toBe(true);
    expect(isAgentEndpointSettingsVisible({ executionEnvironment: 'storeClient', appOwnership: 'expo' })).toBe(true);
  });

  it('hides in release builds', () => {
    expect(isAgentEndpointSettingsVisible({ executionEnvironment: 'standalone', appOwnership: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @incipel/mobile test -- agentEndpoint.test.ts
```

Expected: FAIL because `apps/mobile/src/agentEndpoint.tsx` does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/mobile/src/agentEndpoint.tsx` with normalization, storage helpers, provider, hook, and endpoint functions. The module stores only the normalized base URL and falls back to `process.env.EXPO_PUBLIC_AGENT_URL`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @incipel/mobile test -- agentEndpoint.test.ts
```

Expected: PASS.

## Task 2: Wire AG-UI and Root Provider

**Files:**
- Modify: `apps/mobile/src/agui/client.ts`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `runEndpoint()` and `loglineEndpoint()` from `apps/mobile/src/agentEndpoint.tsx`.
- Consumes: `AgentEndpointProvider`.

- [ ] **Step 1: Add failing endpoint expectations**

Extend `apps/mobile/src/agentEndpoint.test.ts` with current-base behavior:

```ts
import { clearInMemoryAgentBaseUrlOverride, setInMemoryAgentBaseUrlOverride, runEndpoint, loglineEndpoint } from './agentEndpoint';

it('uses the in-memory override for AG-UI endpoints', () => {
  setInMemoryAgentBaseUrlOverride('http://192.168.1.23:4111');
  expect(runEndpoint()).toBe('http://192.168.1.23:4111/run');
  expect(loglineEndpoint()).toBe('http://192.168.1.23:4111/logline');
  clearInMemoryAgentBaseUrlOverride();
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @incipel/mobile test -- agentEndpoint.test.ts
```

Expected: FAIL until override functions and endpoint helpers are wired.

- [ ] **Step 3: Update AG-UI client and root layout**

Move `runEndpoint()` and `loglineEndpoint()` out of `apps/mobile/src/agui/client.ts` or re-export them from `apps/mobile/src/agui/client.ts` after importing from `agentEndpoint.tsx`. Wrap `AppShell` in `AgentEndpointProvider` in `apps/mobile/app/_layout.tsx`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @incipel/mobile test -- agentEndpoint.test.ts
pnpm --filter @incipel/mobile typecheck
```

Expected: both pass.

## Task 3: Settings UI and Documentation

**Files:**
- Modify: `apps/mobile/app/(app)/settings.tsx`
- Modify: `apps/mobile/src/i18n.tsx`
- Modify: `apps/mobile/.env.example`
- Modify: `docs/worktree-dev.md`
- Modify: `docs/adr/0011-mastra-node-agent-runtime.md`

**Interfaces:**
- Consumes: `useAgentEndpointSettings()`.
- Consumes: i18n keys `agentEndpointSection`, `agentEndpointLabel`, `agentEndpointPlaceholder`, `agentEndpointSave`, `agentEndpointReset`, `agentEndpointCurrent`, `agentEndpointInvalid`, `agentEndpointSaved`, `agentEndpointDefault`.

- [ ] **Step 1: Add failing i18n key expectations**

Add a test to `apps/mobile/src/agentEndpoint.test.ts` or a focused i18n test that imports `DICT` indirectly through exported keys only if the project exposes them. If no public i18n test hook exists, rely on TypeScript by adding the keys to `TKey` through `DICT.zh`.

- [ ] **Step 2: Implement UI**

Add a card under the Reading section or after General:

- label: `Agent 地址`
- text input: full URL or host plus port
- save button
- reset button
- current effective URL text
- invalid input message

Render the whole section only when `useAgentEndpointSettings().visible` is true.

- [ ] **Step 3: Update docs**

Document that `EXPO_PUBLIC_AGENT_URL` remains the default and that Expo Go/development build users can override it inside Settings. Note that release builds hide this setting.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @incipel/mobile test -- agentEndpoint.test.ts
pnpm --filter @incipel/mobile typecheck
git diff --check
```

Expected: all pass.

## Self-Review

- Spec coverage: The plan covers accepted input forms, persistence, endpoint use, release hiding, reset behavior, and docs.
- Placeholder scan: No `TBD` or unspecified implementation steps remain.
- Type consistency: The same function names are used across tasks.
