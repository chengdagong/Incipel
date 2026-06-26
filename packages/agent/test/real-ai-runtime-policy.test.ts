import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('real AI integration test policy', () => {
  it('real AI integration test itself is not conditionally skipped', async () => {
    const testSource = await readFile(new URL('./real-ai-runtime.integration.test.ts', import.meta.url), 'utf8');
    const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');

    expect(testSource).not.toContain('it.skip');
    expect(testSource).not.toContain('INCIPEL_REAL_AI_INTEGRATION');
    expect(packageJson).not.toContain('INCIPEL_REAL_AI_INTEGRATION');
  });

  it('default agent test excludes real AI and the dedicated script keeps running it', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.test).toContain('--exclude test/real-ai-runtime.integration.test.ts');
    expect(packageJson.scripts['test:real-ai']).toBe('vitest run test/real-ai-runtime.integration.test.ts');
  });

  it('CI runs real AI integration only on main push, not pull requests', async () => {
    const ci = await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

    expect(ci).toContain('pull_request:');
    expect(ci).toContain('push:');
    expect(ci).toContain('branches: [main]');
    expect(ci).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(ci).toContain('pnpm --filter @incipel/agent test:real-ai');
    expect(ci).toContain('pnpm --filter @incipel/agent exec vitest run --exclude test/real-ai-runtime.integration.test.ts');
  });
});
