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
    message: string,
    public readonly cause?: unknown,
    public readonly silent = false,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

type GoogleTokenResult = { type: 'success'; idToken: string | null } | { type: 'cancelled' };
export type GoogleAccessTokenResult =
  | { type: 'success'; accessToken: string }
  | { type: 'missing' }
  | { type: 'failed'; error: unknown };

export type GoogleNativeAdapter = {
  ensureConfigured(): Promise<void>;
  signIn(): Promise<GoogleTokenResult>;
  requestAccessToken(scopes: string[]): Promise<GoogleAccessTokenResult>;
  classifyError(error: unknown): GoogleAuthError | null | Promise<GoogleAuthError | null>;
};

type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string } | null;
type SupabaseAuthContext = 'signIn' | 'link';

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

let configured = false;

async function googleSignInModule() {
  return import('@react-native-google-signin/google-signin');
}

async function platformOS(): Promise<string> {
  const { Platform } = await import('react-native');
  return Platform.OS;
}

export const nativeGoogleAdapter: GoogleNativeAdapter = {
  async ensureConfigured() {
    if (!WEB_CLIENT_ID) {
      throw new GoogleAuthError('configuration', 'Google 登录配置未完成,请稍后再试。');
    }
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
    const code = (error as { code?: string } | null)?.code;
    if (!code) return null;
    const { statusCodes } = await googleSignInModule();
    if (code === statusCodes.SIGN_IN_CANCELLED) {
      return new GoogleAuthError('cancelled', '用户取消 Google 登录', error, true);
    }
    if (code === statusCodes.IN_PROGRESS) {
      return new GoogleAuthError('in_progress', 'Google 登录正在进行', error, true);
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return new GoogleAuthError(
        'play_services_unavailable',
        '当前设备暂不能使用 Google 登录,请更新 Google Play 服务或使用其他入口。',
        error,
      );
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

function accountConflictError(context: SupabaseAuthContext, cause: unknown): GoogleAuthError {
  const message =
    context === 'signIn'
      ? '该 Google 账号暂不能用于登录,请换一个 Google 账号,或稍后重试。'
      : '该 Google 账号已经绑定到一个账号。请换一个 Google 账号,或退出当前匿名会话后再登录。';
  return new GoogleAuthError('account_conflict', message, cause);
}

function classifySupabaseError(error: AuthErrorLike, context: SupabaseAuthContext): GoogleAuthError {
  const code = typeof error?.code === 'string' ? error.code : null;
  if (code) {
    if (code === 'identity_already_exists') {
      return accountConflictError(context, error);
    }
    if (CONFIGURATION_ERROR_CODES.has(code)) {
      return new GoogleAuthError('configuration', 'Google 登录配置未完成,请稍后再试。', error);
    }
    return new GoogleAuthError('unknown', 'Google 登录失败,请稍后重试。', error);
  }

  const message = error?.message ?? '';
  if (/already.*linked|already.*registered|already.*exists|different user/i.test(message)) {
    return accountConflictError(context, error);
  }
  if (CONFIGURATION_MESSAGE_PATTERN.test(message)) {
    return new GoogleAuthError('configuration', 'Google 登录配置未完成,请稍后再试。', error);
  }
  return new GoogleAuthError('unknown', 'Google 登录失败,请稍后重试。', error);
}

async function getGoogleIdToken(google: GoogleNativeAdapter): Promise<string> {
  await google.ensureConfigured();
  const result = await google.signIn();
  if (result.type === 'cancelled') {
    throw new GoogleAuthError('cancelled', '用户取消 Google 登录', undefined, true);
  }
  if (!result.idToken) {
    throw new GoogleAuthError('configuration', 'Google 登录失败,请稍后重试。');
  }
  return result.idToken;
}

async function getGoogleAccessToken(google: GoogleNativeAdapter): Promise<string> {
  const result = await google.requestAccessToken(GOOGLE_SCOPES);
  if (result.type === 'success') return result.accessToken;
  throw new GoogleAuthError(
    'unknown',
    'Google 登录失败,请稍后重试。',
    result.type === 'failed' ? result.error : undefined,
  );
}

async function wrapGoogleError(google: GoogleNativeAdapter, error: unknown): Promise<never> {
  if (error instanceof GoogleAuthError) throw error;
  const classified = await google.classifyError(error);
  if (classified) throw classified;
  throw new GoogleAuthError('unknown', 'Google 登录失败,请稍后重试。', error);
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
      throw classifySupabaseError(error, 'signIn');
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
      throw classifySupabaseError(error, 'link');
    }
  } catch (e) {
    return wrapGoogleError(google, e);
  }
}

export async function getGoogleProviderLabel(input?: {
  auth?: Pick<GoogleSupabaseAuth, 'getUserIdentities'>;
  appMetadataProvider?: unknown;
}): Promise<'google' | 'apple' | 'signed-in'> {
  const auth = input?.auth ?? (await defaultSupabaseAuth());
  const appMetadataProvider = typeof input?.appMetadataProvider === 'string' ? input.appMetadataProvider : null;
  const { data, error } = await auth.getUserIdentities();
  if (!error && data?.identities) {
    const providers = data.identities.map((identity) => identity.provider);
    if (providers.includes('google')) return 'google';
    if (providers.includes('apple')) return 'apple';
  }
  if (appMetadataProvider === 'google') return 'google';
  if (appMetadataProvider === 'apple') return 'apple';
  return 'signed-in';
}
