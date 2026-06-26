import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyScreenplay, normalizeScreenplay, type Screenplay } from '@incipel/shared';

const agentPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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
