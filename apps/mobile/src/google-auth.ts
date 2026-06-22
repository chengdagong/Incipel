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

export type GoogleNativeAdapter = {
  ensureConfigured(): Promise<void>;
  signIn(): Promise<GoogleTokenResult>;
  requestAccessToken(scopes: string[]): Promise<string | null>;
  classifyError(error: unknown): GoogleAuthError | null;
};

type AuthErrorLike = { message?: string } | null;

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
      return tokens.accessToken;
    } catch (e) {
      return null;
    }
  },

  classifyError(error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'SIGN_IN_CANCELLED') {
      return new GoogleAuthError('cancelled', '用户取消 Google 登录', error, true);
    }
    if (code === 'IN_PROGRESS') {
      return new GoogleAuthError('in_progress', 'Google 登录正在进行', error, true);
    }
    if (code === 'PLAY_SERVICES_NOT_AVAILABLE') {
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

function classifySupabaseError(error: AuthErrorLike): GoogleAuthError {
  const message = error?.message ?? '';
  if (/already.*linked|already.*registered|already.*exists|different user/i.test(message)) {
    return new GoogleAuthError(
      'account_conflict',
      '该 Google 账号已被使用,请换一个 Google 账号,或退出当前匿名会话后再登录。',
      error,
    );
  }
  if (/provider|client|audience|invalid.*token|jwt/i.test(message)) {
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

function wrapGoogleError(google: GoogleNativeAdapter, error: unknown): never {
  if (error instanceof GoogleAuthError) throw error;
  const classified = google.classifyError(error);
  if (classified) throw classified;
  throw new GoogleAuthError('unknown', 'Google 登录失败,请稍后重试。', error);
}

export async function signInWithGoogle(input?: GoogleAuthDeps): Promise<Session> {
  const { google, auth } = await authDeps(input);
  try {
    const idToken = await getGoogleIdToken(google);
    const accessToken = await google.requestAccessToken(GOOGLE_SCOPES);
    const { data, error } = await auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      ...(accessToken ? { access_token: accessToken } : {}),
    });
    if (error || !data?.session) {
      throw classifySupabaseError(error);
    }
    return data.session;
  } catch (e) {
    wrapGoogleError(google, e);
  }
}

export async function linkGoogleIdentity(input?: GoogleAuthDeps): Promise<void> {
  const { google, auth } = await authDeps(input);
  try {
    const idToken = await getGoogleIdToken(google);
    const accessToken = await google.requestAccessToken(GOOGLE_SCOPES);
    if (!accessToken) {
      throw new GoogleAuthError('configuration', 'Google 登录失败,请稍后重试。');
    }
    const { error } = await auth.linkIdentity({
      provider: 'google',
      token: idToken,
      access_token: accessToken,
    });
    if (error) {
      throw classifySupabaseError(error);
    }
  } catch (e) {
    wrapGoogleError(google, e);
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
