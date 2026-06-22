import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
  GoogleAuthError,
  getGoogleProviderLabel,
  linkGoogleIdentity,
  nativeGoogleAdapter,
  signInWithGoogle,
} from './google-auth';
import type { GoogleNativeAdapter, GoogleSupabaseAuth } from './google-auth';

const googleModule = vi.hoisted(() => ({
  statusCodes: {
    SIGN_IN_CANCELLED: '12501',
    IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
  GoogleSignin: {
    getTokens: vi.fn(async () => ({ accessToken: 'google-access-token', idToken: 'google-id-token' })),
  },
}));

vi.mock('@react-native-google-signin/google-signin', () => googleModule);

function session(provider: string): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      app_metadata: { provider, providers: [provider] },
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-06-22T00:00:00.000Z',
    },
  } as Session;
}

function native(overrides: Partial<GoogleNativeAdapter> = {}): GoogleNativeAdapter {
  return {
    ensureConfigured: vi.fn(),
    signIn: vi.fn(async () => ({ type: 'success' as const, idToken: 'google-id-token' })),
    requestAccessToken: vi.fn(async () => ({ type: 'success' as const, accessToken: 'google-access-token' })),
    classifyError: vi.fn(() => null),
    ...overrides,
  };
}

function auth(overrides: Partial<GoogleSupabaseAuth> = {}): GoogleSupabaseAuth {
  return {
    signInWithIdToken: vi.fn(async () => ({ data: { session: session('google') }, error: null })),
    linkIdentity: vi.fn(async () => ({ data: {}, error: null })),
    getUserIdentities: vi.fn(async () => ({ data: { identities: [] }, error: null })),
    ...overrides,
  };
}

describe('signInWithGoogle', () => {
  it('passes Google idToken and accessToken to Supabase Auth', async () => {
    const google = native();
    const supabaseAuth = auth();

    const result = await signInWithGoogle({
      google,
      auth: supabaseAuth,
    });

    expect(result.user.id).toBe('user-1');
    expect(google.signIn).toHaveBeenCalledWith();
    expect(google.requestAccessToken).toHaveBeenCalledWith(['email', 'profile', 'openid']);
    expect(supabaseAuth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
      access_token: 'google-access-token',
    });
  });

  it('throws a silent cancellation error when the user cancels Google Sign-In', async () => {
    const google = native({
      signIn: vi.fn(async () => ({ type: 'cancelled' as const })),
    });

    await expect(
      signInWithGoogle({
        google,
        auth: auth(),
      }),
    ).rejects.toMatchObject({ kind: 'cancelled', silent: true });
  });

  it('throws a configuration error when Google does not return an idToken', async () => {
    const google = native({
      signIn: vi.fn(async () => ({ type: 'success' as const, idToken: null })),
    });

    await expect(
      signInWithGoogle({
        google,
        auth: auth(),
      }),
    ).rejects.toMatchObject({ kind: 'configuration' });
  });

  it('does not call Supabase when Google accessToken retrieval fails', async () => {
    const supabaseAuth = auth();

    await expect(
      signInWithGoogle({
        google: native({
          requestAccessToken: vi.fn(async () => ({ type: 'failed' as const, error: new Error('network') })),
        }),
        auth: supabaseAuth,
      }),
    ).rejects.toMatchObject({ kind: 'unknown' });

    expect(supabaseAuth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('keeps structured Supabase session errors out of configuration messaging', async () => {
    await expect(
      signInWithGoogle({
        google: native(),
        auth: auth({
          signInWithIdToken: vi.fn(async () => ({
            data: null,
            error: { code: 'session_expired', message: 'JWT expired for provider client' },
          })),
        }),
      }),
    ).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('uses login-specific copy for structured account conflicts', async () => {
    try {
      await signInWithGoogle({
        google: native(),
        auth: auth({
          signInWithIdToken: vi.fn(async () => ({
            data: null,
            error: { code: 'identity_already_exists', message: 'Identity already exists' },
          })),
        }),
      });
      throw new Error('expected signInWithGoogle to throw');
    } catch (e) {
      expect(e).toMatchObject({ kind: 'account_conflict' });
      expect((e as Error).message).not.toContain('当前匿名会话');
    }
  });
});

describe('linkGoogleIdentity', () => {
  it('links the current Supabase user with Google idToken and accessToken', async () => {
    const google = native();
    const supabaseAuth = auth();

    await linkGoogleIdentity({
      google,
      auth: supabaseAuth,
    });

    expect(google.signIn).toHaveBeenCalledWith();
    expect(google.requestAccessToken).toHaveBeenCalledWith(['email', 'profile', 'openid']);
    expect(supabaseAuth.linkIdentity).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
      access_token: 'google-access-token',
    });
  });

  it('classifies identity-already-linked errors as account conflicts', async () => {
    const supabaseAuth = auth({
      linkIdentity: vi.fn(async () => ({
        data: null,
        error: { code: 'identity_already_exists', message: 'Identity is already linked to another user' },
      })),
    });

    await expect(
      linkGoogleIdentity({
        google: native(),
        auth: supabaseAuth,
      }),
    ).rejects.toMatchObject({ kind: 'account_conflict' });
  });

  it('classifies manual linking disabled by Supabase code', async () => {
    await expect(
      linkGoogleIdentity({
        google: native(),
        auth: auth({
          linkIdentity: vi.fn(async () => ({
            data: null,
            error: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' },
          })),
        }),
      }),
    ).rejects.toMatchObject({ kind: 'configuration' });
  });

  it('does not call Supabase when Google accessToken is missing during linking', async () => {
    const supabaseAuth = auth();

    await expect(
      linkGoogleIdentity({
        google: native({
          requestAccessToken: vi.fn(async () => ({ type: 'missing' as const })),
        }),
        auth: supabaseAuth,
      }),
    ).rejects.toMatchObject({ kind: 'unknown' });

    expect(supabaseAuth.linkIdentity).not.toHaveBeenCalled();
  });
});

describe('getGoogleProviderLabel', () => {
  it('prefers identities over app_metadata provider', async () => {
    const label = await getGoogleProviderLabel({
      auth: auth({
        getUserIdentities: vi.fn(async () => ({
          data: { identities: [{ provider: 'google' }] },
          error: null,
        })),
      }),
      appMetadataProvider: 'apple',
    });

    expect(label).toBe('google');
  });

  it('falls back to app_metadata provider when identities cannot be loaded', async () => {
    const label = await getGoogleProviderLabel({
      auth: auth({
        getUserIdentities: vi.fn(async () => ({
          data: null,
          error: { message: 'offline' },
        })),
      }),
      appMetadataProvider: 'apple',
    });

    expect(label).toBe('apple');
  });
});

describe('GoogleAuthError', () => {
  it('preserves error kind for UI mapping', () => {
    const err = new GoogleAuthError('play_services_unavailable', '设备暂不能使用 Google 登录');
    expect(err.kind).toBe('play_services_unavailable');
    expect(err.silent).toBe(false);
  });
});

describe('nativeGoogleAdapter', () => {
  it('classifies native SDK in-progress status code as silent', async () => {
    const err = await nativeGoogleAdapter.classifyError({ code: googleModule.statusCodes.IN_PROGRESS });
    expect(err).toMatchObject({ kind: 'in_progress', silent: true });
  });

  it('classifies native SDK cancelled status code as silent', async () => {
    const err = await nativeGoogleAdapter.classifyError({ code: googleModule.statusCodes.SIGN_IN_CANCELLED });
    expect(err).toMatchObject({ kind: 'cancelled', silent: true });
  });

  it('returns failed when native getTokens throws', async () => {
    const failure = new Error('network');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    googleModule.GoogleSignin.getTokens.mockRejectedValueOnce(failure);

    try {
      await expect(nativeGoogleAdapter.requestAccessToken(['email'])).resolves.toEqual({
        type: 'failed',
        error: failure,
      });
      expect(warn).toHaveBeenCalledWith('[google-auth] 获取 Google access token 失败:', failure);
    } finally {
      warn.mockRestore();
    }
  });
});
