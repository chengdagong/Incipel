import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyScreenplay } from '@incipel/shared';
import { afterEach, describe, expect, it } from 'vitest';
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
  it('creates and returns an empty Screenplay when the file does not exist', async () => {
    const store = createStudioScreenplayStore(await tempFile());

    const state = await store.read();

    expect(state.world).toEqual([]);
    expect(state.characters).toEqual([]);
    expect(state.outline).toEqual([]);
    expect(state.scenes).toEqual([]);
    expect(state.meta.accent).toBe('#A8552E');
  });

  it('persists written state and returns normalized state on read', async () => {
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
