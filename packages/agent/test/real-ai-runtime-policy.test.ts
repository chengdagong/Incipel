import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('real AI integration test policy', () => {
  it('real AI integration test is not conditionally skipped', async () => {
    const testSource = await readFile(new URL('./real-ai-runtime.integration.test.ts', import.meta.url), 'utf8');
    const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');

    expect(testSource).not.toContain('it.skip');
    expect(testSource).not.toContain('INCIPEL_REAL_AI_INTEGRATION');
    expect(packageJson).not.toContain('INCIPEL_REAL_AI_INTEGRATION');
  });
});
