import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CHAT_SOURCE = readFileSync(new URL('../app/(app)/chat.tsx', import.meta.url), 'utf8');
const I18N_SOURCE = readFileSync(new URL('./i18n.tsx', import.meta.url), 'utf8');

describe('no stage concept', () => {
  it('does not expose stage or maturity labels in the chat header', () => {
    for (const source of [CHAT_SOURCE, I18N_SOURCE]) {
      expect(source).not.toContain('STAGE_I18N');
      expect(source).not.toContain('stageLabel');
      expect(source).not.toContain('headerStage');
      expect(source).not.toContain('阶段 ·');
      expect(source).not.toContain('Stage ·');
    }
  });
});
