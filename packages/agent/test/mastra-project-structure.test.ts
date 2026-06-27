import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(packageRoot, 'src');

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(srcRoot, relativePath), 'utf8');
}

describe('Mastra project structure', () => {
  it('keeps the Mastra application, agents, and tools under src/mastra', async () => {
    const expectedFiles = [
      'mastra/index.ts',
      'mastra/agents/index.ts',
      'mastra/agents/logline.ts',
      'mastra/agents/mckee-story-critic.ts',
      'mastra/agents/screenwriter.ts',
      'mastra/agents/studio-screenwriter.ts',
      'mastra/processors/openrouter-web-tool-policy.ts',
      'mastra/tools/mckee-critic-review.ts',
      'mastra/tools/openrouter-tools.ts',
      'mastra/tools/screenplay.ts',
      'mastra/tools/studio-screenplay.ts',
      'mastra/tools/studio-screenplay-store.ts',
    ];

    for (const file of expectedFiles) {
      expect(existsSync(join(srcRoot, file)), file).toBe(true);
    }

    const mastraEntry = await readSource('mastra/index.ts');
    expect(mastraEntry).toContain('new Mastra({');
    expect(mastraEntry).toContain('agents: createMastraAgents(config)');

    const agentRegistry = await readSource('mastra/agents/index.ts');
    expect(agentRegistry).toContain('screenwriter:');
    expect(agentRegistry).toContain("'studio-screenwriter':");
    expect(agentRegistry).toContain("'mckee-story-critic':");
    expect(agentRegistry).toContain('logline:');
  });
});
