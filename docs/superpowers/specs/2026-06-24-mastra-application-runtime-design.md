# Mastra Application Runtime Design

## Goal

Move the agent runtime from a Hono server that manually creates Mastra `Agent` instances into a Mastra application that owns agent registration and server setup.

## Current State

`packages/agent/src/index.ts` starts a Hono app directly with `@hono/node-server`. `packages/agent/src/app.ts` owns `/run`, `/logline`, and `/health`. `packages/agent/src/model/mastra.ts` creates `Agent` instances inside each provider call.

This works, but Mastra is only used as an `Agent` wrapper. The runtime is not yet a Mastra application with registered agents and a server adapter.

## Target State

The runtime uses one Mastra application:

- `Mastra` registers the `screenwriter` and `logline` agents.
- `@mastra/hono` initializes the Hono app through `MastraServer`.
- `/run`, `/logline`, and `/health` are Mastra custom API routes registered with `registerApiRoute`.
- The Incipel AG-UI SSE contract remains unchanged.
- Supabase authentication, store creation, request validation, and `runTurnCore` behavior remain unchanged.

## Dependencies

Use the verified npm versions:

- `@mastra/core@1.46.0`
- `@mastra/hono@1.5.1`
- `hono@^4.12.8`

`@mastra/hono` is the official Hono server adapter. It registers Mastra endpoints and middleware on a Hono app while allowing project-specific custom API routes.

## Main Files

- `packages/agent/src/mastra-app.ts`: creates the Mastra application, registered agents, and custom API routes.
- `packages/agent/src/routes.ts`: exposes the custom route definitions for `/run`, `/logline`, and `/health`.
- `packages/agent/src/model/mastra.ts`: uses registered agents from the Mastra application instead of constructing agents per call.
- `packages/agent/src/index.ts`: creates Hono, initializes `MastraServer`, and starts the Node server.
- Existing HTTP tests remain the behavior contract for the custom routes.

## Behavior To Preserve

- `/health` returns the existing JSON shape.
- `/run` still returns AG-UI SSE events and uses `runTurnCore`.
- `/logline` still authenticates unless `DEV_NO_AUTH=1`, validates the body, and returns JSON.
- `STORE=memory` and `DEV_NO_AUTH=1` retain their local development behavior.
- The mobile client continues using `EXPO_PUBLIC_AGENT_URL`.

## Testing Strategy

- Add a test that the Node entrypoint initializes `MastraServer` before calling `serve`.
- Add a test that the Mastra provider retrieves registered agents from the application.
- Keep the existing `/run`, `/logline`, `/health`, agent runtime, and dev CLI tests passing.
- Run `pnpm test`, `pnpm typecheck`, `node --test tools/incipel-dev/cli.test.mjs`, and `git diff --check`.
