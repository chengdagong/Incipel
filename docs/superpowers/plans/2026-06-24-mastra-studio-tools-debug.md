# Mastra Studio Tools Debug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mastra Studio show and execute the same screenplay tool family that the real screenwriter agent uses, while keeping Studio writes local to a gitignored JSON file and keeping `/run` on dynamic per-turn tool schemas.

**Architecture:** Extract shared screenplay Mastra tool creation into a factory. The production `screenwriter` agent remains tool-free at agent registration time and receives dynamic `toolsets` per `/run` call. A new `studio-screenwriter` agent registers full agent-level tools backed by a local JSON Screenplay store. Studio-only read/reset tools expose local state inspection without touching Supabase or a real dev session.

**Tech Stack:** TypeScript, Mastra, Zod, Vitest, Node `fs/promises`, `@incipel/shared` Screenplay contracts.

---

### Task 1: Shared Tool Schemas

**Files:**
- Modify: `packages/shared/src/tools.ts`
- Modify: `packages/shared/test/contract.test.ts`

- [ ] **Step 1: Add failing tests for Studio schemas**

Add tests in `packages/shared/test/contract.test.ts` under `describe('buildStudioToolSchemas')`:

```ts
import {
  TOOL_NAMES,
  buildStudioToolSchemas,
  buildToolSchemas,
  idSetsOf,
  emptyScreenplay,
  // existing imports...
} from '../src/index';

describe('buildStudioToolSchemas', () => {
  it('exposes every screenplay tool even when the Screenplay is empty', () => {
    const tools = buildStudioToolSchemas();
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('uses string ids for Studio update/remove tools', () => {
    const tools = buildStudioToolSchemas();
    expect(() => tools.update_character.parse({ id: 'char_any', role: '主角' })).not.toThrow();
    expect(() => tools.remove_world_section.parse({ id: 'world_any' })).not.toThrow();
    expect(() =>
      tools.add_character_attr.parse({ characterId: 'char_any', label: '身份', value: '测试' }),
    ).not.toThrow();
    expect(() => tools.update_character_attr.parse({ attrId: 'cattr_any', value: '测试' })).not.toThrow();
  });
});
```

Run:

```bash
pnpm --filter @incipel/shared test -- contract.test.ts
```

Expected: test fails because `buildStudioToolSchemas` is not exported.

- [ ] **Step 2: Refactor schema builders without changing production behavior**

Change `packages/shared/src/tools.ts` so product and Studio schemas share field definitions:

```ts
type IdSchema = z.ZodType<string>;

const toolSchemaBuilders = {
  set_meta: () => z.object({ title: z.string().optional(), logline: z.string().optional() }),
  add_world_section: () => z.object({ title: z.string(), text: z.string() }),
  update_world_section: (id: IdSchema) =>
    z.object({ id, title: z.string().optional(), text: z.string().optional() }),
  remove_world_section: (id: IdSchema) => z.object({ id }),
  add_character: () =>
    z.object({
      name: z.string(),
      role: z.string().optional(),
      attrs: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    }),
  update_character: (id: IdSchema) =>
    z.object({ id, name: z.string().optional(), role: z.string().optional() }),
  remove_character: (id: IdSchema) => z.object({ id }),
  add_character_attr: (characterId: IdSchema) =>
    z.object({ characterId, label: z.string(), value: z.string() }),
  update_character_attr: (attrId: IdSchema) =>
    z.object({ attrId, label: z.string().optional(), value: z.string().optional() }),
  remove_character_attr: (attrId: IdSchema) => z.object({ attrId }),
  add_act: () => z.object({ act: z.string(), beat: z.string() }),
  update_act: (id: IdSchema) =>
    z.object({ id, act: z.string().optional(), beat: z.string().optional() }),
  remove_act: (id: IdSchema) => z.object({ id }),
  add_scene: () => z.object({ slug: z.string(), content: z.string() }),
  update_scene: (id: IdSchema) =>
    z.object({ id, slug: z.string().optional(), content: z.string().optional() }),
  remove_scene: (id: IdSchema) => z.object({ id }),
  propose_options: () => z.object({ options: z.array(z.string()).max(3) }),
} satisfies Record<ToolName, (...args: z.ZodTypeAny[]) => z.ZodTypeAny>;
```

Keep `buildToolSchemas(ids)` semantically unchanged:
- add/set/propose tools are always present.
- update/remove tools are present only when the matching id array is non-empty.
- id fields still use `idEnum(ids...)`.

Add:

```ts
export function buildStudioToolSchemas(): Record<ToolName, z.ZodTypeAny> {
  const id = z.string();
  return {
    set_meta: toolSchemaBuilders.set_meta(),
    add_world_section: toolSchemaBuilders.add_world_section(),
    update_world_section: toolSchemaBuilders.update_world_section(id),
    remove_world_section: toolSchemaBuilders.remove_world_section(id),
    add_character: toolSchemaBuilders.add_character(),
    update_character: toolSchemaBuilders.update_character(id),
    remove_character: toolSchemaBuilders.remove_character(id),
    add_character_attr: toolSchemaBuilders.add_character_attr(id),
    update_character_attr: toolSchemaBuilders.update_character_attr(id),
    remove_character_attr: toolSchemaBuilders.remove_character_attr(id),
    add_act: toolSchemaBuilders.add_act(),
    update_act: toolSchemaBuilders.update_act(id),
    remove_act: toolSchemaBuilders.remove_act(id),
    add_scene: toolSchemaBuilders.add_scene(),
    update_scene: toolSchemaBuilders.update_scene(id),
    remove_scene: toolSchemaBuilders.remove_scene(id),
    propose_options: toolSchemaBuilders.propose_options(),
  };
}
```

- [ ] **Step 3: Re-run shared tests**

Run:

```bash
pnpm --filter @incipel/shared test -- contract.test.ts
```

Expected: tests pass and existing dynamic id-gated behavior is unchanged.

### Task 2: Shared Mastra Tool Factory

**Files:**
- Create: `packages/agent/src/screenplay-mastra-tools.ts`
- Modify: `packages/agent/src/model/mastra.ts`
- Modify: `packages/agent/test/mastra-runtime.test.ts`

- [ ] **Step 1: Add or extend tests for tool factory use**

Extend `packages/agent/test/mastra-runtime.test.ts` expectations so `streamTurn()` still passes only the dynamic tools it receives and the generated tool returns `{ ok: true }`.

Keep the existing expectations:

```ts
expect(Object.keys(h.lastStreamOptions.toolsets.screenplay)).toEqual(['add_character']);
expect(h.createdTools[0]).toMatchObject({
  id: 'add_character',
  description: 'Incipel screenplay tool: add_character',
});
await expect(h.createdTools[0].execute()).resolves.toEqual({ ok: true });
```

Expected before implementation: this fails on the description if the old local helper still says `Incipel internal screenplay tool`.

- [ ] **Step 2: Create common factory**

Create `packages/agent/src/screenplay-mastra-tools.ts`:

```ts
import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { z } from 'zod';

export type ScreenplayToolExecute = (input: {
  toolName: string;
  args: unknown;
}) => Promise<unknown> | unknown;

export function createScreenplayMastraTools(input: {
  schemas: Record<string, z.ZodTypeAny>;
  executeTool: ScreenplayToolExecute;
}): ToolsInput {
  const tools: ToolsInput = {};
  for (const [name, schema] of Object.entries(input.schemas)) {
    tools[name] = createTool({
      id: name,
      description: `Incipel screenplay tool: ${name}`,
      inputSchema: schema,
      execute: async ({ context }: { context?: unknown } = {}) =>
        input.executeTool({ toolName: name, args: context }),
    });
  }
  return tools;
}

export function createNoopScreenplayMastraTools(schemas: Record<string, z.ZodTypeAny>): ToolsInput {
  return createScreenplayMastraTools({
    schemas,
    executeTool: async () => ({ ok: true }),
  });
}
```

- [ ] **Step 3: Use common factory in production provider**

In `packages/agent/src/model/mastra.ts`:
- Remove local imports of `ToolsInput`, `createTool`, and `z` if no longer needed.
- Import `createNoopScreenplayMastraTools`.
- Replace `toMastraTools(input.tools)` with `createNoopScreenplayMastraTools(input.tools)`.
- Remove the local `toMastraTools()` function.

Run:

```bash
pnpm --filter @incipel/agent test -- mastra-runtime.test.ts
```

Expected: production provider behavior still passes.

### Task 3: Studio Local Screenplay Store

**Files:**
- Create: `packages/agent/src/studio-screenplay-store.ts`
- Create: `packages/agent/test/studio-screenplay-store.test.ts`

- [ ] **Step 1: Add failing store tests**

Create `packages/agent/test/studio-screenplay-store.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyScreenplay } from '@incipel/shared';
import { createStudioScreenplayStore } from '../src/studio-screenplay-store';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function tempFile() {
  tempDir = await mkdtemp(join(tmpdir(), 'incipel-studio-screenplay-'));
  return join(tempDir, 'state.json');
}

describe('createStudioScreenplayStore', () => {
  it('creates an empty Screenplay when the file does not exist', async () => {
    const store = createStudioScreenplayStore(await tempFile());
    const state = await store.read();
    expect(state).toMatchObject({ world: [], characters: [], outline: [], scenes: [] });
    expect(state.meta.accent).toBe('#A8552E');
  });

  it('persists written state and normalizes legacy characters on read', async () => {
    const store = createStudioScreenplayStore(await tempFile());
    const state = emptyScreenplay();
    state.characters.push({ id: 'char_a', name: 'A', role: 'old', attrs: [] });
    await store.write(state);

    const read = await store.read();
    expect(read.characters[0]).toEqual({ id: 'char_a', name: 'A', role: 'old', attrs: [] });
  });

  it('reset overwrites the file with a fresh empty Screenplay', async () => {
    const store = createStudioScreenplayStore(await tempFile());
    const state = emptyScreenplay();
    state.world.push({ id: 'world_a', title: 'T', text: 'X' });
    await store.write(state);

    const reset = await store.reset();
    expect(reset.world).toEqual([]);
    expect((await store.read()).world).toEqual([]);
  });
});
```

Expected before implementation: import fails.

- [ ] **Step 2: Implement file-backed store**

Create `packages/agent/src/studio-screenplay-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyScreenplay, normalizeScreenplay, type Screenplay } from '@incipel/shared';

const agentPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_STUDIO_SCREENPLAY_PATH = resolve(
  agentPackageDir,
  '.mastra-studio-screenplay.json',
);

export type StudioScreenplayStore = {
  read(): Promise<Screenplay>;
  write(state: Screenplay): Promise<Screenplay>;
  reset(): Promise<Screenplay>;
};

export function createStudioScreenplayStore(
  filePath = DEFAULT_STUDIO_SCREENPLAY_PATH,
): StudioScreenplayStore {
  async function write(state: Screenplay): Promise<Screenplay> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
  }

  return {
    async read() {
      try {
        const raw = await readFile(filePath, 'utf8');
        return normalizeScreenplay(JSON.parse(raw) as Screenplay);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const state = emptyScreenplay();
        await write(state);
        return state;
      }
    },
    write,
    async reset() {
      return write(emptyScreenplay());
    },
  };
}

export const studioScreenplayStore = createStudioScreenplayStore();
```

Run:

```bash
pnpm --filter @incipel/agent test -- studio-screenplay-store.test.ts
```

Expected: store tests pass.

### Task 4: Studio Tool Execution

**Files:**
- Create: `packages/agent/src/studio-screenplay-tools.ts`
- Create: `packages/agent/test/studio-screenplay-tools.test.ts`

- [ ] **Step 1: Add failing Studio tool tests**

Create `packages/agent/test/studio-screenplay-tools.test.ts` with a `createTool` mock:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyScreenplay, TOOL_NAMES } from '@incipel/shared';
import type { StudioScreenplayStore } from '../src/studio-screenplay-store';

const h = vi.hoisted(() => ({
  createdTools: [] as any[],
}));

vi.mock('@mastra/core/tools', () => ({
  createTool: (definition: any) => {
    h.createdTools.push(definition);
    return definition;
  },
}));

beforeEach(() => {
  h.createdTools = [];
});

function memoryStore(initial = emptyScreenplay()): StudioScreenplayStore {
  let state = structuredClone(initial);
  return {
    async read() {
      return structuredClone(state);
    },
    async write(next) {
      state = structuredClone(next);
      return structuredClone(state);
    },
    async reset() {
      state = emptyScreenplay();
      return structuredClone(state);
    },
  };
}

describe('createStudioScreenplayTools', () => {
  it('registers every screenplay tool plus Studio read/reset tools', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const tools = createStudioScreenplayTools(memoryStore());
    expect(Object.keys(tools).sort()).toEqual(
      [...TOOL_NAMES, 'read_studio_screenplay', 'reset_studio_screenplay'].sort(),
    );
  });

  it('applies product tools to local Screenplay state', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const tools = createStudioScreenplayTools(memoryStore());

    const result = await tools.add_character.execute({
      context: { name: '林岑', role: '主角' },
    });

    expect(result.ok).toBe(true);
    expect(result.patch[0]).toMatchObject({ op: 'add', path: '/characters/0' });
    expect(result.state.characters[0]).toMatchObject({ name: '林岑', role: '主角' });
  });

  it('returns a structured error and current state when applyToolCall rejects an id', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const tools = createStudioScreenplayTools(memoryStore());

    const result = await tools.update_character.execute({
      context: { id: 'char_missing', role: '幽灵' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('character id 不存在');
    expect(result.state.characters).toEqual([]);
  });

  it('read and reset tools inspect local state', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const store = memoryStore();
    const tools = createStudioScreenplayTools(store);

    await tools.add_world_section.execute({ context: { title: '世界', text: '内容' } });
    expect((await tools.read_studio_screenplay.execute()).state.world).toHaveLength(1);
    expect((await tools.reset_studio_screenplay.execute()).state.world).toEqual([]);
  });
});
```

Expected before implementation: import fails.

- [ ] **Step 2: Implement Studio tools**

Create `packages/agent/src/studio-screenplay-tools.ts`:

```ts
import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { buildStudioToolSchemas, type JsonPatchOp, type Screenplay } from '@incipel/shared';
import { z } from 'zod';
import { ApplyError, applyToolCall } from './apply.ts';
import {
  studioScreenplayStore,
  type StudioScreenplayStore,
} from './studio-screenplay-store.ts';
import { createScreenplayMastraTools } from './screenplay-mastra-tools.ts';

type StudioToolResult =
  | { ok: true; patch: JsonPatchOp[]; state: Screenplay }
  | { ok: false; error: string; state: Screenplay };

export function createStudioScreenplayTools(
  store: StudioScreenplayStore = studioScreenplayStore,
): ToolsInput {
  return {
    ...createScreenplayMastraTools({
      schemas: buildStudioToolSchemas(),
      executeTool: async ({ toolName, args }): Promise<StudioToolResult> => {
        const state = await store.read();
        try {
          const result = applyToolCall(toolName, args, state);
          if (result.patch.length) await store.write(result.state);
          return { ok: true, patch: result.patch, state: result.state };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            state,
          };
        }
      },
    }),
    read_studio_screenplay: createTool({
      id: 'read_studio_screenplay',
      description: 'Read the local Mastra Studio Screenplay debug state.',
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, state: await store.read() }),
    }),
    reset_studio_screenplay: createTool({
      id: 'reset_studio_screenplay',
      description: 'Reset the local Mastra Studio Screenplay debug state.',
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, state: await store.reset() }),
    }),
  };
}
```

Run:

```bash
pnpm --filter @incipel/agent test -- studio-screenplay-tools.test.ts
```

Expected: Studio tool tests pass.

Implementation note: If `ApplyError` is unused by the final code, do not import it. The result shape should remain structured for all errors.

### Task 5: Register `studio-screenwriter` Agent

**Files:**
- Modify: `packages/agent/src/mastra-app.ts`
- Modify: `packages/agent/test/mastra-app.test.ts`

- [ ] **Step 1: Update failing Agent registration tests**

Change `packages/agent/test/mastra-app.test.ts` so it expects three registered agents:

```ts
expect(agents).toHaveProperty('screenwriter');
expect(agents).toHaveProperty('studio-screenwriter');
expect(agents).toHaveProperty('logline');
expect(h.agentConfigs).toHaveLength(3);
```

Add assertions:

```ts
expect(screenwriter.tools).toBeUndefined();

const studioScreenwriter = h.agentConfigs.find(
  (agent) => agent.id === 'incipel-studio-screenwriter',
)!;
expect(studioScreenwriter).toMatchObject({
  id: 'incipel-studio-screenwriter',
  name: 'Incipel Studio Screenwriter',
  model: 'openrouter/openai/gpt-test',
  instructions: buildScreenwriterInstructions(),
});
expect(Object.keys(studioScreenwriter.tools)).toEqual(
  expect.arrayContaining(['add_character', 'update_character', 'read_studio_screenplay', 'reset_studio_screenplay']),
);
```

Expected before implementation: test fails because only two agents exist.

- [ ] **Step 2: Register Studio Agent with agent-level tools**

In `packages/agent/src/mastra-app.ts`:

```ts
import type { ToolsInput } from '@mastra/core/agent';
import { createStudioScreenplayTools } from './studio-screenplay-tools.ts';

export type IncipelAgentName = 'screenwriter' | 'studio-screenwriter' | 'logline';

export function createMastraAgents(config: ModelRuntimeConfig) {
  const screenwriterInstructions = buildScreenwriterInstructions();
  return {
    screenwriter: createAgent(
      'incipel-screenwriter',
      'Incipel Screenwriter',
      config.turn,
      screenwriterInstructions,
    ),
    'studio-screenwriter': createAgent(
      'incipel-studio-screenwriter',
      'Incipel Studio Screenwriter',
      config.turn,
      screenwriterInstructions,
      createStudioScreenplayTools(),
    ),
    logline: createAgent('incipel-logline', 'Incipel Logline', config.logline, LOGLINE_INSTRUCTIONS),
  };
}

function createAgent(
  id: string,
  name: string,
  useConfig: ModelUseConfig,
  instructions: string,
  tools?: ToolsInput,
): Agent {
  return new Agent({
    id,
    name,
    instructions,
    model: mastraModelId(useConfig.model),
    ...(tools ? { tools } : {}),
  });
}
```

Keep `packages/agent/src/model/mastra.ts` calling only:

```ts
registry.getAgent('screenwriter');
registry.getAgent('logline');
```

Run:

```bash
pnpm --filter @incipel/agent test -- mastra-app.test.ts mastra-runtime.test.ts
```

Expected: tests pass and production provider still uses `screenwriter`.

### Task 6: Docs And Local File Ignore

**Files:**
- Modify: `.gitignore`
- Modify: `docs/worktree-dev.md`

- [ ] **Step 1: Ignore Studio debug state**

Add to `.gitignore`:

```gitignore
# Mastra Studio local Screenplay debug state
packages/agent/.mastra-studio-screenplay.json
```

- [ ] **Step 2: Document Studio Agent usage**

Add a short section to `docs/worktree-dev.md`:

```md
### Mastra Studio local Screenplay tools

Mastra Studio exposes `studio-screenwriter` for manual tool debugging. This agent uses the same static screenwriter instructions and the same screenplay tool schemas as the production `screenwriter`, but writes tool results to `packages/agent/.mastra-studio-screenplay.json`.

Use `read_studio_screenplay` to inspect the local debug state and `reset_studio_screenplay` to start from an empty Screenplay. The production `/run` route continues to use `screenwriter` with per-turn dynamic `toolsets` and does not read or write this file.
```

### Task 7: Final Verification

**Files:**
- No direct edits unless verification reveals an issue.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @incipel/shared test -- contract.test.ts
pnpm --filter @incipel/agent test -- mastra-runtime.test.ts mastra-app.test.ts studio-screenplay-store.test.ts studio-screenplay-tools.test.ts
```

Expected: all focused tests exit 0.

- [ ] **Step 2: Run package verification**

```bash
pnpm --filter @incipel/shared typecheck
pnpm --filter @incipel/agent typecheck
pnpm --filter @incipel/shared test
pnpm --filter @incipel/agent test
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect git diff**

```bash
git diff --stat
git diff -- packages/shared/src/tools.ts packages/agent/src/model/mastra.ts packages/agent/src/mastra-app.ts
```

Expected: production behavior remains dynamic per-turn tools, Studio behavior uses agent-level tools, and local Studio JSON state is ignored.
