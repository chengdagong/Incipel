import type { Session } from '@supabase/supabase-js';

export type GoogleAuthErrorKind =
  | 'cancelled'
  | 'in_progress'
  | 'play_services_unavailable'
  | 'configuration'
  | 'account_conflict'
  | 'unknown';

export class GoogleAuthError extends Error {
  constructor(
    public readonly kind: GoogleAuthErrorKind,
    public readonly cause?: unknown,
    public readonly silent = false,
  ) {
    super(kind);
    this.name = 'GoogleAuthError';
  }
}

export type GoogleAuthUiContext = 'login' | 'link';
export type GoogleAuthMessageKey =
  | 'googleFailed'
  | 'googleConfigMissing'
  | 'googlePlayServicesMissing'
  | 'googleLoginConflict'
  | 'googleUsed';

type GoogleTokenResult = { type: 'success'; idToken: string | null } | { type: 'cancelled' };
export type GoogleAccessTokenResult =
  | { type: 'success'; accessToken: string }
  | { type: 'missing' }
  | { type: 'failed'; error: unknown };

export type GoogleNativeAdapter = {
  ensureConfigured(): Promise<void>;
  signIn(): Promise<GoogleTokenResult>;
  requestAccessToken(): Promise<GoogleAccessTokenResult>;
  classifyError(error: unknown): GoogleAuthError | null | Promise<GoogleAuthError | null>;
};

type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string } | null;

export type GoogleSupabaseAuth = {
  signInWithIdToken(input: {
    provider: 'google';
    token: string;
    access_token?: string;
  }): Promise<{ data: { session: Session | null } | null; error: AuthErrorLike }>;
  linkIdentity(input: {
    provider: 'google';
    token: string;
    access_token: string;
  }): Promise<{ data: unknown; error: AuthErrorLike }>;
  getUserIdentities(): Promise<{
    data: { identities: Array<{ provider: string }> } | null;
    error: AuthErrorLike;
  }>;
};

type GoogleAuthDeps = {
  google?: GoogleNativeAdapter;
  auth?: GoogleSupabaseAuth;
};

const GOOGLE_SCOPES = ['email', 'profile', 'openid'];
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const CONFIGURATION_ERROR_CODES = new Set([
  'manual_linking_disabled',
  'provider_disabled',
  'oauth_provider_not_supported',
  'unexpected_audience',
]);
const CONFIGURATION_MESSAGE_PATTERN =
  /manual linking|provider.*disabled|provider.*not.*enabled|oauth provider|unsupported provider|client[_ ]?id|audience/i;
const MISSING_NATIVE_GOOGLE_MODULE_PATTERN =
  /RNGoogleSignin|NativeGoogleSignin|TurboModuleRegistry\.getEnforcing/i;
const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const GOOGLE_CLIENT_SECRET_PATTERN = /GOCSPX-[A-Za-z0-9_-]+/g;

let configured = false;

type GoogleAuthLogDetails = {
  name?: string;
  kind?: GoogleAuthErrorKind;
  code?: string;
  status?: number;
  message?: string;
  silent?: boolean;
  cause?: GoogleAuthLogDetails;
};

function sanitizeLogValue(value: string): string {
  return value
    .replace(TOKEN_PATTERN, '<jwt>')
    .replace(GOOGLE_CLIENT_SECRET_PATTERN, 'GOCSPX-<redacted>');
}

function stringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === 'string' ? sanitizeLogValue(prop) : undefined;
}

function numberProp(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === 'number' ? prop : undefined;
}

function googleAuthLogDetails(error: unknown, depth = 0): GoogleAuthLogDetails {
  if (error instanceof GoogleAuthError) {
    return {
      name: error.name,
      kind: error.kind,
      message: sanitizeLogValue(error.message),
      silent: error.silent,
      ...(error.cause && depth < 3 ? { cause: googleAuthLogDetails(error.cause, depth + 1) } : {}),
    };
  }
  if (error && typeof error === 'object') {
    const cause = (error as { cause?: unknown }).cause;
    return {
      name: stringProp(error, 'name'),
      code: stringProp(error, 'code'),
      status: numberProp(error, 'status'),
      message: stringProp(error, 'message'),
      ...(cause && depth < 3 ? { cause: googleAuthLogDetails(cause, depth + 1) } : {}),
    };
  }
  if (typeof error === 'string') return { message: sanitizeLogValue(error) };
  return { message: String(error) };
}

export function googleAuthLogDetailsForDebug(error: unknown): GoogleAuthLogDetails {
  return googleAuthLogDetails(error);
}

function missingNativeGoogleModuleCause(error: unknown): unknown | null {
  if (!error || typeof error !== 'object') return null;
  const cause = (error as { cause?: unknown }).cause;
  const nested = missingNativeGoogleModuleCause(cause);
  if (nested) return nested;

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && MISSING_NATIVE_GOOGLE_MODULE_PATTERN.test(message)) {
    return error;
  }
  return null;
}

async function assertGoogleNativeRuntime() {
  const Constants = (await import('expo-constants')).default;
  if (Constants.appOwnership === 'expo') {
    throw new GoogleAuthError(
      'configuration',
      new Error('Google Sign-In requires a development build. Expo Go does not include RNGoogleSignin.'),
    );
  }
}

async function googleSignInModule() {
  try {
    return await import('@react-native-google-signin/google-signin');
  } catch (error) {
    const nativeModuleCause = missingNativeGoogleModuleCause(error);
    if (nativeModuleCause) {
      throw new GoogleAuthError('configuration', nativeModuleCause);
    }
    throw error;
  }
}

async function platformOS(): Promise<string> {
  const { Platform } = await import('react-native');
  return Platform.OS;
}

export const nativeGoogleAdapter: GoogleNativeAdapter = {
  async ensureConfigured() {
    if (!WEB_CLIENT_ID) {
      throw new GoogleAuthError('configuration', new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.'));
    }
    await assertGoogleNativeRuntime();
    const { GoogleSignin } = await googleSignInModule();
    if (!configured) {
      GoogleSignin.configure({
        scopes: GOOGLE_SCOPES,
        webClientId: WEB_CLIENT_ID,
        ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}),
      });
      configured = true;
    }
    if ((await platformOS()) === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
  },

  async signIn() {
    const { GoogleSignin, isCancelledResponse, isSuccessResponse } = await googleSignInModule();
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) return { type: 'cancelled' };
    if (!isSuccessResponse(response)) return { type: 'success', idToken: null };
    return { type: 'success', idToken: response.data.idToken };
  },

  async requestAccessToken() {
    const { GoogleSignin } = await googleSignInModule();
    try {
      const tokens = await GoogleSignin.getTokens();
      return tokens.accessToken
        ? { type: 'success', accessToken: tokens.accessToken }
        : { type: 'missing' };
    } catch (e) {
      console.warn('[google-auth] 获取 Google access token 失败:', e);
      return { type: 'failed', error: e };
    }
  },

  async classifyError(error) {
    const nativeModuleCause = missingNativeGoogleModuleCause(error);
    if (nativeModuleCause) {
      return new GoogleAuthError('configuration', nativeModuleCause);
    }
    const code = (error as { code?: string } | null)?.code;
    if (!code) return null;
    const { statusCodes } = await googleSignInModule();
    if (code === statusCodes.SIGN_IN_CANCELLED) {
      return new GoogleAuthError('cancelled', error, true);
    }
    if (code === statusCodes.IN_PROGRESS) {
      return new GoogleAuthError('in_progress', error, true);
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return new GoogleAuthError('play_services_unavailable', error);
    }
    return null;
  },
};

async function defaultSupabaseAuth(): Promise<GoogleSupabaseAuth> {
  const { supabase } = await import('./supabase');
  return supabase.auth as GoogleSupabaseAuth;
}

async function authDeps(input?: GoogleAuthDeps): Promise<{ google: GoogleNativeAdapter; auth: GoogleSupabaseAuth }> {
  return {
    google: input?.google ?? nativeGoogleAdapter,
    auth: input?.auth ?? (await defaultSupabaseAuth()),
  };
}

function accountConflictError(cause: unknown): GoogleAuthError {
  return new GoogleAuthError('account_conflict', cause);
}

function classifySupabaseError(error: AuthErrorLike): GoogleAuthError {
  const code = typeof error?.code === 'string' ? error.code : null;
  if (code) {
    if (code === 'identity_already_exists') {
      return accountConflictError(error);
    }
    if (CONFIGURATION_ERROR_CODES.has(code)) {
      return new GoogleAuthError('configuration', error);
    }
    return new GoogleAuthError('unknown', error);
  }

  const message = error?.message ?? '';
  if (/already.*linked|already.*registered|already.*exists|different user/i.test(message)) {
    return accountConflictError(error);
  }
  if (CONFIGURATION_MESSAGE_PATTERN.test(message)) {
    return new GoogleAuthError('configuration', error);
  }
  return new GoogleAuthError('unknown', error);
}

async function getGoogleIdToken(google: GoogleNativeAdapter): Promise<string> {
  await google.ensureConfigured();
  const result = await google.signIn();
  if (result.type === 'cancelled') {
    throw new GoogleAuthError('cancelled', undefined, true);
  }
  if (!result.idToken) {
    throw new GoogleAuthError('configuration', new Error('Google Sign-In did not return an idToken.'));
  }
  return result.idToken;
}

async function getGoogleAccessToken(google: GoogleNativeAdapter): Promise<string> {
  const result = await google.requestAccessToken();
  if (result.type === 'success') return result.accessToken;
  throw new GoogleAuthError('unknown', result.type === 'failed' ? result.error : undefined);
}

async function wrapGoogleError(google: GoogleNativeAdapter, error: unknown): Promise<never> {
  if (error instanceof GoogleAuthError) throw error;
  const classified = await google.classifyError(error);
  if (classified) throw classified;
  throw new GoogleAuthError('unknown', error);
}

export async function signInWithGoogle(input?: GoogleAuthDeps): Promise<Session> {
  const { google, auth } = await authDeps(input);
  try {
    const idToken = await getGoogleIdToken(google);
    const accessToken = await getGoogleAccessToken(google);
    const { data, error } = await auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      access_token: accessToken,
    });
    if (error || !data?.session) {
      throw classifySupabaseError(error);
    }
    return data.session;
  } catch (e) {
    return wrapGoogleError(google, e);
  }
}

export async function linkGoogleIdentity(input?: GoogleAuthDeps): Promise<void> {
  const { google, auth } = await authDeps(input);
  try {
    const idToken = await getGoogleIdToken(google);
    const accessToken = await getGoogleAccessToken(google);
    const { error } = await auth.linkIdentity({
      provider: 'google',
      token: idToken,
      access_token: accessToken,
    });
    if (error) {
      throw classifySupabaseError(error);
    }
  } catch (e) {
    return wrapGoogleError(google, e);
  }
}

export async function getGoogleProviderLabel(input?: {
  auth?: Pick<GoogleSupabaseAuth, 'getUserIdentities'>;
  appMetadataProvider?: unknown;
}): Promise<'google' | 'apple' | 'signed-in'> {
  const appMetadataProvider = typeof input?.appMetadataProvider === 'string' ? input.appMetadataProvider : null;
  if (appMetadataProvider === 'google') return 'google';
  if (appMetadataProvider === 'apple') return 'apple';

  const auth = input?.auth ?? (await defaultSupabaseAuth());
  const { data, error } = await auth.getUserIdentities();
  if (!error && data?.identities) {
    const providers = data.identities.map((identity) => identity.provider);
    if (providers.includes('google')) return 'google';
    if (providers.includes('apple')) return 'apple';
  }
  return 'signed-in';
}

export function googleAuthMessageKey(
  error: unknown,
  context: GoogleAuthUiContext,
): GoogleAuthMessageKey | null {
  if (!(error instanceof GoogleAuthError)) return 'googleFailed';
  if (error.silent) return null;
  if (error.kind === 'configuration') return 'googleConfigMissing';
  if (error.kind === 'play_services_unavailable') return 'googlePlayServicesMissing';
  if (error.kind === 'account_conflict') {
    return context === 'login' ? 'googleLoginConflict' : 'googleUsed';
  }
  return 'googleFailed';
}
