# Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Sign-In and Google identity linking for the iOS / Android Expo app while keeping Google and Apple auth code separate.

**Architecture:** Google uses `@react-native-google-signin/google-signin@16.1.2` Original Google Sign-In to obtain Google `idToken` and `accessToken`; Supabase Auth remains the source of Supabase session, JWT, and user id. Apple stays on the existing `expo-apple-authentication` path; Google and Apple share only session infrastructure and UI state.

**Tech Stack:** Expo 55, React Native 0.83, Supabase JS, `@react-native-google-signin/google-signin@16.1.2`, Vitest 2.1.9 for mobile unit tests.

---

## File Structure

- Modify `apps/mobile/package.json`: add Google Sign-In dependency, add mobile `test` script, add Vitest dev dependency matching the rest of the monorepo.
- Modify `apps/mobile/app.json`: add Google Sign-In config plugin with an iOS URL scheme placeholder that setup docs instruct developers to replace.
- Create `apps/mobile/src/google-auth.ts`: Google-only native adapter boundary, error classification, sign-in and link-identity helpers.
- Create `apps/mobile/src/google-auth.test.ts`: pure unit tests against injected adapters and Supabase auth stubs.
- Modify `apps/mobile/app/login.tsx`: make the Google button active, keep Apple handler separate.
- Modify `apps/mobile/app/(app)/settings.tsx`: make account display provider-aware and bind anonymous users to Google.
- Modify `apps/mobile/src/i18n.tsx`: add Google account display and binding copy in all supported interface languages.
- Modify `supabase/config.toml`: mark Google provider as a configured manual step and provide local placeholders.
- Create `docs/google-sign-in-setup.md`: operator setup guide, parallel to Apple setup doc.
- Create `docs/adr/0008-google-sign-in-native-id-token.md`: record the decision that Google enters v1 via native ID token flow and no account merge.
- Modify `docs/adr/0005-auth-entry-in-v1.md` and `README.md`: link the new decision and setup document.
- Modify `apps/mobile/.maestro/README.md` and `apps/mobile/.maestro/flows/smoke-anon-login.yaml`: document and assert `login-google`.

## Implementation Tasks

### Task 1: Dependency And Test Harness

- [x] Add `@react-native-google-signin/google-signin@16.1.2`.
- [x] Add `vitest@^2.1.9` to `@incipel/mobile`, matching the existing workspace test runner version.
- [x] Add `test: "vitest run"` to `apps/mobile/package.json`.
- [x] Run `pnpm --filter @incipel/mobile test` and confirm the runner starts; before tests exist, “No test files found” is expected.

### Task 2: TDD For Google Auth

- [x] Write `apps/mobile/src/google-auth.test.ts` before production code.
- [x] Confirm RED failure: `./google-auth` missing.
- [x] Implement `apps/mobile/src/google-auth.ts`.
- [x] Confirm GREEN:

```bash
pnpm --filter @incipel/mobile test -- src/google-auth.test.ts
```

Expected: 8 tests pass.

Important implementation adjustment discovered during execution:

- `@react-native-google-signin/google-signin@16.1.2` Original API returns `idToken` via `GoogleSignin.signIn()` and `accessToken` via `GoogleSignin.getTokens()`.
- The Original API does not expose a Google sign-in nonce parameter. Supabase `signInWithIdToken` only requires `nonce` when the ID token contains a nonce claim. Google does not receive a nonce in this implementation; Apple keeps its existing nonce path.
- Google login and linking both require `access_token` before calling Supabase because Google `idToken` may contain `at_hash`.

### Task 3: Login And Settings UI

- [x] Make the login page Google button active with `testID="login-google"`.
- [x] Keep `loginWithApple()` and `loginWithGoogle()` as separate handlers.
- [x] Wire `signInWithGoogle()` into the login page.
- [x] Wire `linkGoogleIdentity()` into the anonymous account row in settings.
- [x] Change settings account display from “non-anonymous means Apple” to provider-aware display.
- [x] Add translated strings for Google account state, linking, and Google errors.
- [x] Verify:

```bash
pnpm --filter @incipel/mobile test -- src/google-auth.test.ts
pnpm --filter @incipel/mobile typecheck
```

Expected: both pass.

### Task 4: Native And Supabase Config

- [x] Add `@react-native-google-signin/google-signin` config plugin to `apps/mobile/app.json`.
- [x] Add explicit placeholder `iosUrlScheme`, documented as a value that must be replaced before native Google verification.
- [x] Enable local `auth.external.google` in `supabase/config.toml` with explicit placeholder client id and local non-secret placeholder secret.

### Task 5: Documentation And ADR

- [x] Add `docs/google-sign-in-setup.md`.
- [x] Add `docs/adr/0008-google-sign-in-native-id-token.md`.
- [x] Update `docs/adr/0005-auth-entry-in-v1.md`.
- [x] Update `README.md`.

### Task 6: Maestro Documentation And Flow

- [x] Add `login-google` selector documentation.
- [x] Add `assertVisible: login-google` to `smoke-anon-login.yaml`.

### Task 7: Final Verification

- [x] Run focused verification:

```bash
pnpm --filter @incipel/mobile test -- src/google-auth.test.ts
pnpm --filter @incipel/mobile typecheck
bash /Users/chengdagong/.claude/skills/plain-chinese/scripts/lint-jargon.sh docs/google-sign-in-setup.md docs/adr/0008-google-sign-in-native-id-token.md docs/adr/0005-auth-entry-in-v1.md README.md apps/mobile/.maestro/README.md docs/superpowers/specs/2026-06-22-google-sign-in-design.md docs/superpowers/plans/2026-06-22-google-sign-in.md
git diff --check
```

- [x] Review expected changed files.
- [x] Commit:

```bash
git add apps/mobile/package.json apps/mobile/app.json apps/mobile/src/google-auth.ts apps/mobile/src/google-auth.test.ts apps/mobile/app/login.tsx 'apps/mobile/app/(app)/settings.tsx' apps/mobile/src/i18n.tsx supabase/config.toml docs/google-sign-in-setup.md docs/adr/0008-google-sign-in-native-id-token.md docs/adr/0005-auth-entry-in-v1.md README.md apps/mobile/.maestro/README.md apps/mobile/.maestro/flows/smoke-anon-login.yaml docs/superpowers/specs/2026-06-22-google-sign-in-design.md docs/superpowers/plans/2026-06-22-google-sign-in.md pnpm-lock.yaml
CODEX_DOCS_REVIEWED=1 git commit -m "feat: 支持 Google 登录"
```

## Self-Review

- Spec coverage: Google login, anonymous Google binding, provider-aware settings display, conflict handling, docs, ADR, and tests are all covered.
- No unfinished markers or unspecified “add error handling” steps remain.
- Type consistency: `GoogleNativeAdapter`, `GoogleSupabaseAuth`, `signInWithGoogle`, `linkGoogleIdentity`, and `getGoogleProviderLabel` are defined in `google-auth.ts` and used by tests / UI.
