# Agent Endpoint Settings Design

## Goal

Add a development-only setting that lets a user override the mobile app's agent server address. The setting must be visible in Expo Go and development build, and hidden in release builds.

## Behavior

- The setting accepts both full URLs, such as `https://agent.example.com`, and host plus port input, such as `192.168.1.23:4111`.
- If the input omits a scheme, the app treats it as `http://...`.
- The app saves the normalized base URL in `AsyncStorage`.
- `runEndpoint()` and `loglineEndpoint()` use the saved override when present, then append `/run` or `/logline`.
- A reset action removes the saved override and returns to `EXPO_PUBLIC_AGENT_URL`.
- Release builds do not render the setting.

## Runtime Visibility

Use Expo Constants to decide whether to show the setting:

- Show when `Constants.executionEnvironment === ExecutionEnvironment.StoreClient`, which covers Expo Go and expo-dev-client development builds.
- Hide when `Constants.executionEnvironment === ExecutionEnvironment.Standalone`, which covers release builds.
- Keep a conservative fallback for older or incomplete constants: `Constants.appOwnership === 'expo' || __DEV__`.

Expo documents `Constants.executionEnvironment` and `ExecutionEnvironment` in the Constants SDK docs: https://docs.expo.dev/versions/latest/sdk/constants/

## Files

- `apps/mobile/src/agentEndpoint.tsx`: normalize, store, load, and expose the effective agent base URL.
- `apps/mobile/src/agentEndpoint.test.ts`: verify URL normalization, endpoint construction, storage behavior, and visibility decisions.
- `apps/mobile/src/agui/client.ts`: replace the fixed module-level `EXPO_PUBLIC_AGENT_URL` constant with the effective URL from `agentEndpoint.tsx`.
- `apps/mobile/app/_layout.tsx`: load the stored override early via an `AgentEndpointProvider`.
- `apps/mobile/app/(app)/settings.tsx`: add the development-only settings UI.
- `apps/mobile/src/i18n.tsx`: add labels for the new settings section.
- `apps/mobile/.env.example`, `docs/worktree-dev.md`, and `docs/adr/0011-mastra-node-agent-runtime.md`: document that development builds can override the baked-in URL locally.

## Testing

- Add tests for host:port normalization, full URL normalization, invalid input, reset behavior, endpoint construction, and release/development visibility.
- Run the new test first and confirm it fails before implementation.
- After implementation, run the focused mobile tests, mobile typecheck, and diff checks.
