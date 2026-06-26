import { buildMckeeStoryCriticInstructions } from '../../prompt.ts';
import type { ModelRuntimeConfig } from '../../model/config.ts';
import { createAgent } from './factory.ts';

export function createMckeeStoryCriticAgent(config: ModelRuntimeConfig) {
  return createAgent(
    'incipel-mckee-story-critic',
    'Incipel McKee Story Critic',
    config.provider,
    config.turn,
    buildMckeeStoryCriticInstructions(),
  );
}
