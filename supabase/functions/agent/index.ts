// Deprecated historical Supabase Edge Function entry.
//
// The supported agent runtime is now the Mastra Node agent server in
// packages/agent/src/index.ts. This file is kept only to document the previous
// deployment target and to make accidental `supabase functions deploy agent`
// fail loudly instead of running an outdated dependency graph.

throw new Error(
  'The Supabase Edge Function agent runtime is deprecated. Use packages/agent/src/index.ts with the Mastra Node agent server.',
);
