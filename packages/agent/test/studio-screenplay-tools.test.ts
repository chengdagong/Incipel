import { emptyScreenplay, TOOL_NAMES, type Screenplay } from '@incipel/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

type ToolDefinition = {
  execute: (args?: unknown, context?: unknown) => Promise<any>;
};

type MemoryStore = StudioScreenplayStore & {
  writeCount: number;
};

type LiveReferenceFailingStore = StudioScreenplayStore & {
  readonly state: Screenplay;
};

type InvalidJsonStore = StudioScreenplayStore & {
  writeCount: number;
};

function memoryStore(initial: Screenplay = emptyScreenplay()): MemoryStore {
  let state = structuredClone(initial);
  let writeCount = 0;

  return {
    get writeCount() {
      return writeCount;
    },
    async read() {
      return structuredClone(state);
    },
    async write(next) {
      writeCount += 1;
      state = structuredClone(next);
      return structuredClone(state);
    },
    async reset() {
      state = emptyScreenplay();
      return structuredClone(state);
    },
  };
}

function invalidJsonStore(): InvalidJsonStore {
  let writeCount = 0;

  return {
    get writeCount() {
      return writeCount;
    },
    async read() {
      throw new SyntaxError('Unexpected token bad json');
    },
    async write() {
      writeCount += 1;
      return emptyScreenplay();
    },
    async reset() {
      return emptyScreenplay();
    },
  };
}

function liveReferenceFailingStore(): LiveReferenceFailingStore {
  const state = emptyScreenplay();
  return {
    get state() {
      return state;
    },
    async read() {
      return state;
    },
    async write() {
      throw new Error('disk full');
    },
    async reset() {
      state.world = [];
      state.characters = [];
      state.outline = [];
      state.scenes = [];
      return state;
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

  it('add_character tool applies to local state', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const tools = createStudioScreenplayTools(memoryStore());

    const result = await (tools.add_character as ToolDefinition).execute(
      { name: '林岑', role: '主角' },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.patch[0]).toMatchObject({ op: 'add', path: '/characters/0' });
    expect(result.state.characters[0]).toMatchObject({ name: '林岑', role: '主角' });
  });

  it('update_character with missing id returns a structured error and current state', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const tools = createStudioScreenplayTools(memoryStore());

    const result = await (tools.update_character as ToolDefinition).execute(
      { id: 'char_missing', role: '幽灵' },
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('character id 不存在');
    expect(result.state.characters).toEqual([]);
  });

  it('read_studio_screenplay returns a structured error when local JSON is invalid', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const store = invalidJsonStore();
    const tools = createStudioScreenplayTools(store);

    const result = await (tools.read_studio_screenplay as ToolDefinition).execute();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unexpected token bad json');
    expect(store.writeCount).toBe(0);
  });

  it('product tools return a structured error when local JSON is invalid', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const store = invalidJsonStore();
    const tools = createStudioScreenplayTools(store);

    const result = await (tools.add_character as ToolDefinition).execute({ name: '林岑' }, {});

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unexpected token bad json');
    expect(result).not.toHaveProperty('state');
    expect(store.writeCount).toBe(0);
  });

  it('read/reset inspect local state', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const store = memoryStore();
    const tools = createStudioScreenplayTools(store);

    await (tools.add_world_section as ToolDefinition).execute({ title: '世界', text: '内容' }, {});

    const read = await (tools.read_studio_screenplay as ToolDefinition).execute();
    expect(read.state.world).toHaveLength(1);

    const reset = await (tools.reset_studio_screenplay as ToolDefinition).execute();
    expect(reset.state.world).toEqual([]);
  });

  it('propose_options returns an empty patch without writing local state', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const store = memoryStore();
    const tools = createStudioScreenplayTools(store);

    const result = await (tools.propose_options as ToolDefinition).execute(
      { options: ['A', 'B'] },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.patch).toEqual([]);
    expect(result.options).toEqual(['A', 'B']);
    expect(store.writeCount).toBe(0);
  });

  it('does not mutate returned or internal state when write fails', async () => {
    const { createStudioScreenplayTools } = await import('../src/studio-screenplay-tools');
    const store = liveReferenceFailingStore();
    const tools = createStudioScreenplayTools(store);

    const result = await (tools.add_character as ToolDefinition).execute(
      { name: '林岑', role: '主角' },
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('disk full');
    expect(result.state.characters).toEqual([]);
    expect(store.state.characters).toEqual([]);
  });
});
