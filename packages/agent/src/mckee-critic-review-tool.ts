import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { buildMckeeStoryCriticPrompt } from './prompt.ts';
import {
  providerOptionsForUse,
  type ModelRuntimeConfig,
  type ModelUseConfig,
} from './model/config.ts';

export const MCKEE_CRITIQUE_TOOL_NAME = 'request_mckee_story_critique';

type MastraCriticAgentLike = {
  stream(
    prompt: string,
    options: Record<string, unknown>,
  ): Promise<{
    text: Promise<string>;
  }>;
};

export type MckeeCriticRegistry = {
  getAgent(name: 'mckee-story-critic'): MastraCriticAgentLike;
};

const mckeeCritiqueInputSchema = z.object({
  userGoal: z.string(),
  draft: z.string(),
  target: z.enum(['outline', 'beats', 'structure', 'scene', 'other']),
});

export function createMckeeCriticReviewTools(input: {
  registry: MckeeCriticRegistry;
  sourcePrompt: string;
  useConfig: ModelUseConfig;
  provider: ModelRuntimeConfig['provider'];
}): ToolsInput {
  return {
    [MCKEE_CRITIQUE_TOOL_NAME]: createTool({
      id: MCKEE_CRITIQUE_TOOL_NAME,
      description: 'Ask the McKee story critic Agent to review an outline or beat draft.',
      inputSchema: mckeeCritiqueInputSchema,
      execute: async (args?: unknown) => {
        const parsed = mckeeCritiqueInputSchema.parse(args);
        const critic = input.registry.getAgent('mckee-story-critic');
        const { prompt } = buildMckeeStoryCriticPrompt({
          sourcePrompt: input.sourcePrompt,
          userGoal: parsed.userGoal,
          draft: parsed.draft,
          target: parsed.target,
        });
        const stream = await critic.stream(prompt, {
          maxSteps: 1,
          toolChoice: 'none',
          modelSettings: modelSettings(input.useConfig),
          providerOptions: providerOptionsForUse(input.provider, input.useConfig),
        });
        return { review: (await stream.text).trim() };
      },
    }),
  };
}

function modelSettings(useConfig: ModelUseConfig): Record<string, unknown> | undefined {
  if (useConfig.temperature === undefined) return undefined;
  return { temperature: useConfig.temperature };
}
