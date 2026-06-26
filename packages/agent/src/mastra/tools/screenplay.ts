import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { z } from 'zod';

export type ScreenplayToolExecute = (input: {
  toolName: string;
  args: unknown;
}) => Promise<unknown> | unknown;

export function createScreenplayMastraTools(input: {
  schemas: Record<string, z.ZodTypeAny>;
  executeTool: ScreenplayToolExecute;
}): ToolsInput {
  const tools: ToolsInput = {};
  for (const [name, schema] of Object.entries(input.schemas)) {
    tools[name] = createTool({
      id: name,
      description: `Incipel screenplay tool: ${name}`,
      inputSchema: schema,
      execute: async (args?: unknown) => input.executeTool({ toolName: name, args }),
    });
  }
  return tools;
}

export function createNoopScreenplayMastraTools(schemas: Record<string, z.ZodTypeAny>): ToolsInput {
  return createScreenplayMastraTools({
    schemas,
    executeTool: async () => ({ ok: true }),
  });
}
