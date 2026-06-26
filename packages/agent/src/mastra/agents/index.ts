import { buildScreenwriterInstructions } from '../../prompt.ts';
import type { ModelRuntimeConfig } from '../../model/config.ts';
import type { MckeeCriticRegistry } from '../tools/mckee-critic-review.ts';
import { createLoglineAgent } from './logline.ts';
import { createMckeeStoryCriticAgent } from './mckee-story-critic.ts';
import { createScreenwriterAgent } from './screenwriter.ts';
import { createStudioScreenwriterAgent } from './studio-screenwriter.ts';

export type IncipelAgentName = 'screenwriter' | 'studio-screenwriter' | 'mckee-story-critic' | 'logline';

export function createMastraAgents(config: ModelRuntimeConfig) {
  const screenwriterInstructions = buildScreenwriterInstructions();
  const mckeeStoryCritic = createMckeeStoryCriticAgent(config);
  const criticRegistry: MckeeCriticRegistry = {
    getAgent: () => mckeeStoryCritic,
  };

  return {
    screenwriter: createScreenwriterAgent(config, screenwriterInstructions),
    'studio-screenwriter': createStudioScreenwriterAgent({
      config,
      instructions: screenwriterInstructions,
      criticRegistry,
    }),
    'mckee-story-critic': mckeeStoryCritic,
    logline: createLoglineAgent(config),
  };
}

export {
  AGENT_PACKAGE_ROOT,
  AGENT_SKILLS_PATH,
  SCREENWRITING_MASTER_SKILL_PATH,
} from '../paths.ts';
