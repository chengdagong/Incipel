import { beforeEach, describe, expect, it, vi } from 'vitest';

const asyncStorageMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    default: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    },
  };
});

const expoConstantsMock = vi.hoisted(() => ({
  default: {
    executionEnvironment: 'storeClient' as string | null,
    appOwnership: null as string | null,
  },
  ExecutionEnvironment: {
    StoreClient: 'storeClient',
    Standalone: 'standalone',
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => asyncStorageMock);
vi.mock('expo-constants', () => expoConstantsMock);

import {
  AGENT_ENDPOINT_STORAGE_KEY,
  buildAgentEndpoint,
  clearAgentBaseUrlOverride,
  clearInMemoryAgentBaseUrlOverride,
  getEffectiveAgentBaseUrl,
  isAgentEndpointSettingsVisible,
  loadAgentBaseUrlOverride,
  loglineEndpoint,
  normalizeAgentBaseUrlInput,
  runEndpoint,
  saveAgentBaseUrlOverride,
  setInMemoryAgentBaseUrlOverride,
} from './agentEndpoint';

describe('normalizeAgentBaseUrlInput', () => {
  it('accepts host plus port and uses http', () => {
    expect(normalizeAgentBaseUrlInput('192.168.1.23:4111')).toEqual({
      ok: true,
      value: 'http://192.168.1.23:4111',
    });
  });

  it('accepts full https URLs and strips trailing slash', () => {
    expect(normalizeAgentBaseUrlInput(' https://agent.example.com/ ')).toEqual({
      ok: true,
      value: 'https://agent.example.com',
    });
  });

  it('keeps a base path and strips known endpoint suffixes', () => {
    expect(normalizeAgentBaseUrlInput('https://agent.example.com/api/run')).toEqual({
      ok: true,
      value: 'https://agent.example.com/api',
    });
  });

  it('rejects unsupported protocols', () => {
    expect(normalizeAgentBaseUrlInput('ftp://agent.example.com')).toEqual({
      ok: false,
      reason: 'protocol',
    });
  });
});

describe('agent endpoint storage and construction', () => {
  beforeEach(() => {
    asyncStorageMock.values.clear();
    vi.clearAllMocks();
    clearInMemoryAgentBaseUrlOverride();
  });

  it('appends endpoint paths after a stored base path', () => {
    expect(buildAgentEndpoint('https://agent.example.com/api', 'run')).toBe('https://agent.example.com/api/run');
    expect(buildAgentEndpoint('https://agent.example.com/api/', 'logline')).toBe(
      'https://agent.example.com/api/logline',
    );
  });

  it('saves, loads, and clears an override', async () => {
    await expect(saveAgentBaseUrlOverride('localhost:4111')).resolves.toEqual({
      ok: true,
      value: 'http://localhost:4111',
    });
    expect(asyncStorageMock.default.setItem).toHaveBeenCalledWith(AGENT_ENDPOINT_STORAGE_KEY, 'http://localhost:4111');
    await expect(loadAgentBaseUrlOverride()).resolves.toBe('http://localhost:4111');

    await clearAgentBaseUrlOverride();
    expect(asyncStorageMock.default.removeItem).toHaveBeenCalledWith(AGENT_ENDPOINT_STORAGE_KEY);
    await expect(loadAgentBaseUrlOverride()).resolves.toBeNull();
  });

  it('uses the in-memory override for AG-UI endpoints', () => {
    setInMemoryAgentBaseUrlOverride('http://192.168.1.23:4111');

    expect(getEffectiveAgentBaseUrl()).toBe('http://192.168.1.23:4111');
    expect(runEndpoint()).toBe('http://192.168.1.23:4111/run');
    expect(loglineEndpoint()).toBe('http://192.168.1.23:4111/logline');
  });
});

describe('isAgentEndpointSettingsVisible', () => {
  it('shows in Expo Go and development client', () => {
    expect(isAgentEndpointSettingsVisible({ executionEnvironment: 'storeClient', appOwnership: null })).toBe(true);
    expect(isAgentEndpointSettingsVisible({ executionEnvironment: 'storeClient', appOwnership: 'expo' })).toBe(true);
  });

  it('hides in release builds', () => {
    expect(isAgentEndpointSettingsVisible({ executionEnvironment: 'standalone', appOwnership: null })).toBe(false);
  });

  it('keeps a safe fallback when Expo constants are incomplete', () => {
    vi.stubGlobal('__DEV__', false);
    try {
      expect(isAgentEndpointSettingsVisible({ executionEnvironment: null, appOwnership: null })).toBe(false);
      expect(isAgentEndpointSettingsVisible({ executionEnvironment: null, appOwnership: 'expo' })).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
