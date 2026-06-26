import { Memory } from '@mastra/memory';
import type { ModelRuntimeConfig } from '../../model/config.ts';
import { SCREENWRITING_MASTER_SKILL_PATH } from '../paths.ts';
import {
  createMckeeCriticReviewTools,
  type MckeeCriticRegistry,
} from '../tools/mckee-critic-review.ts';
import { createStudioScreenplayTools } from '../tools/studio-screenplay.ts';
import { createAgent } from './factory.ts';

const STUDIO_MCKEE_CRITIC_SOURCE_PROMPT =
  'Mastra Studio 调试会话。studio-screenwriter 使用与生产 screenwriter 相同的静态 instructions,并通过本地 Studio screenplay tools 读写调试剧本;调用方应在 userGoal 与 draft 中提供本次需要评论的目标和草稿。';

export function createStudioScreenwriterAgent(input: {
  config: ModelRuntimeConfig;
  instructions: string;
  criticRegistry: MckeeCriticRegistry;
}) {
  return createAgent(
    'incipel-studio-screenwriter',
    'Incipel Studio Screenwriter',
    input.config.provider,
    input.config.turn,
    input.instructions,
    {
      skills: [SCREENWRITING_MASTER_SKILL_PATH],
      memory: createStudioMemory(),
      tools: {
        ...createStudioScreenplayTools(),
        ...createMckeeCriticReviewTools({
          registry: input.criticRegistry,
          sourcePrompt: STUDIO_MCKEE_CRITIC_SOURCE_PROMPT,
          useConfig: input.config.turn,
          provider: input.config.provider,
        }),
      },
    },
  );
}

function createStudioMemory() {
  return new Memory({
    options: {
      lastMessages: 50,
      generateTitle: true,
    },
  });
}
