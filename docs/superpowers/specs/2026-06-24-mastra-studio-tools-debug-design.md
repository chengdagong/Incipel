# Mastra Studio Tools Debug Design

## Goal

Mastra Studio must be able to select `studio-screenwriter`, see the screenplay tools, call those tools, and observe real `Screenplay` changes across server restarts. The debug state is a gitignored local JSON file, not a Supabase session and not `documents.state`.

Normal `/run` behavior must remain unchanged: the product `screenwriter` Agent keeps using per-turn dynamic `toolsets` generated from the current authoritative `Screenplay`.

## Non-Goals

- Do not make Studio write to Supabase.
- Do not make Studio share state with a real conversation session.
- Do not remove the existing per-turn id enum checks from `/run`.
- Do not make the mobile client or iOS simulator use the Studio debug file.

## Current Context

The repo currently has two registered Mastra agents:

- `screenwriter`: used by `/run`; receives static instructions from `buildScreenwriterInstructions()`.
- `logline`: used by `/logline`; receives static instructions from `LOGLINE_INSTRUCTIONS`.

Runtime tools for `screenwriter` are still passed per call through `agent.stream(prompt, { toolsets })`. Studio reads the registered Agent itself, so it can see `instructions`, but `screenwriter.listTools()` is empty.

`buildToolSchemas(idSetsOf(state))` intentionally creates dynamic schemas:

- `add_*`, `set_meta`, and `propose_options` always exist.
- `update_*` and `remove_*` only exist when the current `Screenplay` has matching ids.
- Existing ids are represented as `z.enum(...)`, so the model cannot pass an id outside the current state.

That dynamic behavior stays in `/run`.

## Proposed Design

Add a third registered Agent:

- `studio-screenwriter`: Studio-only Agent for manual tool debugging.

It uses the same `buildScreenwriterInstructions()` as `screenwriter`, but it also registers fixed agent-level tools so Studio can list and call them.

The fixed Studio tools must not be a second handwritten copy of the product tools. Instead, add a common factory module:

```ts
createScreenplayMastraTools({
  schemas,
  executeTool,
})
```

Both execution paths use this factory:

- `/run`: `schemas = buildToolSchemas(idSetsOf(state))`; `executeTool = async () => ({ ok: true })`.
- Studio: `schemas = buildStudioToolSchemas()`; `executeTool = applyToolCallToStudioFile`.

This keeps tool names, descriptions, schema construction shape, and Mastra `createTool(...)` wrapping in one place. The two paths differ only in schema policy and execution policy.

## Schema Policy

`/run` keeps current dynamic schemas from `buildToolSchemas(idSetsOf(state))`.

Studio gets a fixed full set of tools:

- All `TOOL_NAMES` are always present.
- `id`, `characterId`, and `attrId` fields are `z.string()` rather than `z.enum(...)`.
- Non-id fields reuse the same schema builders as the product tool schema.

This means Studio always shows every tool. Invalid ids are rejected during execution by `applyToolCall`, not hidden at schema time.

## Studio Debug State

Add a gitignored local file:

```text
packages/agent/.mastra-studio-screenplay.json
```

The file stores exactly one `Screenplay`.

Add helper module:

```text
packages/agent/src/studio-screenplay-store.ts
```

Responsibilities:

- `readStudioScreenplay()`: if the file does not exist, return `emptyScreenplay()`.
- `writeStudioScreenplay(state)`: write formatted JSON.
- `resetStudioScreenplay()`: write `emptyScreenplay()` and return it.
- On invalid JSON, return a typed error and leave the existing file unchanged.

The path is centralized in one helper so tests can inject a temporary path.

## Studio Tool Execution

Add helper module:

```text
packages/agent/src/studio-screenplay-tools.ts
```

It creates Studio tools using the shared factory and `buildStudioToolSchemas()`.

For product tools:

1. Read the current local `Screenplay`.
2. Call `applyToolCall(toolName, args, state)`.
3. If it succeeds, write the new `Screenplay` to the local file.
4. Return:

```ts
{
  ok: true,
  patch,
  state
}
```

If `applyToolCall` throws `ApplyError`, return:

```ts
{
  ok: false,
  error,
  state
}
```

and do not write the file.

`propose_options` returns options and leaves the file unchanged.

Add two Studio-only helper tools:

- `read_studio_screenplay`: returns the current local `Screenplay`.
- `reset_studio_screenplay`: resets the local file to `emptyScreenplay()` and returns it.

These helper tools are only registered on `studio-screenwriter`.

## Agent Registration

Update `createMastraAgents(config)` so it returns:

- `screenwriter`
- `studio-screenwriter`
- `logline`

`screenwriter` stays product-only and has no agent-level tools. `/run` continues passing per-call `toolsets`.

`studio-screenwriter` has agent-level tools from `createStudioScreenplayTools(...)`.

`IncipelAgentName` includes `studio-screenwriter`, but `createMastraProvider()` continues requesting only `screenwriter` and `logline`.

## Error Handling

- Missing local file: treat as `emptyScreenplay()`.
- Invalid JSON: return `{ ok: false, error }`; do not overwrite the file.
- `ApplyError`: return `{ ok: false, error, state }`; do not write the file.
- Write failure: return `{ ok: false, error }`.
- Concurrent writes: not handled in v1. Studio manual use is expected to be sequential. A later change can add a small in-process queue around file operations if manual debugging produces overlapping writes.

## Testing

Add focused tests:

1. `studio-screenplay-store.test.ts`
   - Missing file returns `emptyScreenplay()`.
   - Write then read returns the same state.
   - Invalid JSON returns an error and does not overwrite the file.
   - Reset writes `emptyScreenplay()`.

2. `studio-screenplay-tools.test.ts`
   - `add_character` writes the local file and returns `patch/state`.
   - `update_character` with a missing id returns `ok:false` and leaves the file unchanged.
   - `propose_options` returns options and leaves the file unchanged.
   - `read_studio_screenplay` and `reset_studio_screenplay` work.

3. `mastra-app.test.ts`
   - `studio-screenwriter` is registered.
   - `studio-screenwriter` uses `buildScreenwriterInstructions()`.
   - `studio-screenwriter` has agent-level tools such as `add_character`, `update_character`, `read_studio_screenplay`, and `reset_studio_screenplay`.
   - Product `screenwriter` still has no agent-level tools.

4. `mastra-runtime.test.ts`
   - `/run` still passes per-call `toolsets`.
   - `createMastraProvider()` still requests `screenwriter` and `logline`, not `studio-screenwriter`.

## Documentation

Update local development documentation to explain:

- Studio users pick `studio-screenwriter` for manual tool debugging.
- Debug state lives in `packages/agent/.mastra-studio-screenplay.json`.
- The debug file is local and gitignored.
- Real `/run` sessions do not read or write that file.

Update `.gitignore` to ignore the debug file.
