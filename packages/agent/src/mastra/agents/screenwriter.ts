import { buildScreenwriterInstructions } from '../../prompt.ts';
import type { ModelRuntimeConfig } from '../../model/config.ts';
import { SCREENWRITING_MASTER_SKILL_PATH } from '../paths.ts';
import { createAgent } from './factory.ts';

export function createScreenwriterAgent(
  config: ModelRuntimeConfig,
  instructions = buildScreenwriterInstructions(),
) {
  return createAgent('incipel-screenwriter', 'Incipel Screenwriter', config.provider, config.turn, instructions, {
    skills: [SCREENWRITING_MASTER_SKILL_PATH],
  });
}
