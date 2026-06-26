import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { buildStudioToolSchemas, type JsonPatchOp, type Screenplay } from '@incipel/shared';
import { z } from 'zod';
import { applyToolCall } from '../../apply.ts';
import { createScreenplayMastraTools } from './screenplay.ts';
import {
  studioScreenplayStore,
  type StudioScreenplayStore,
} from './studio-screenplay-store.ts';

type StudioToolResult =
  | { ok: true; patch: JsonPatchOp[]; state: Screenplay; options?: string[] }
  | { ok: false; error: string; state?: Screenplay };

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getOptions(args: unknown): string[] | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const options = (args as { options?: unknown }).options;
  return Array.isArray(options) && options.every((item) => typeof item === 'string')
    ? options
    : undefined;
}

export function createStudioScreenplayTools(
  store: StudioScreenplayStore = studioScreenplayStore,
): ToolsInput {
  return {
    ...createScreenplayMastraTools({
      schemas: buildStudioToolSchemas(),
      executeTool: async ({ toolName, args }): Promise<StudioToolResult> => {
        let state: Screenplay;
        try {
          state = await store.read();
        } catch (error) {
          return { ok: false, error: errorToString(error) };
        }

        const draft = structuredClone(state) as Screenplay;
        try {
          const result = applyToolCall(toolName, args, draft);
          if (result.patch.length) await store.write(result.state);
          if (toolName === 'propose_options') {
            return {
              ok: true,
              patch: result.patch,
              state: result.state,
              options: getOptions(args),
            };
          }
          return { ok: true, patch: result.patch, state: result.state };
        } catch (error) {
          return {
            ok: false,
            error: errorToString(error),
            state,
          };
        }
      },
    }),
    read_studio_screenplay: createTool({
      id: 'read_studio_screenplay',
      description: 'Read the local Mastra Studio Screenplay debug state.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return { ok: true, state: await store.read() };
        } catch (error) {
          return { ok: false, error: errorToString(error) };
        }
      },
    }),
    reset_studio_screenplay: createTool({
      id: 'reset_studio_screenplay',
      description: 'Reset the local Mastra Studio Screenplay debug state.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return { ok: true, state: await store.reset() };
        } catch (error) {
          return { ok: false, error: errorToString(error) };
        }
      },
    }),
  };
}
