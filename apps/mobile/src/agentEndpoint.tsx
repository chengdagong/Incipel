import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const AGENT_ENDPOINT_STORAGE_KEY = 'scn_agent_base_url_v1';

const DEFAULT_AGENT_BASE_URL = process.env.EXPO_PUBLIC_AGENT_URL ?? '';
const STORE_CLIENT = (ExecutionEnvironment as Record<string, string | undefined>)?.StoreClient ?? 'storeClient';
const STANDALONE = (ExecutionEnvironment as Record<string, string | undefined>)?.Standalone ?? 'standalone';

let inMemoryAgentBaseUrlOverride: string | null = null;

export type AgentEndpointParseResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'url' | 'protocol' | 'credentials' };

type ConstantsLike = {
  executionEnvironment?: string | null;
  appOwnership?: string | null;
};

export type AgentEndpointSettings = {
  ready: boolean;
  visible: boolean;
  defaultBaseUrl: string;
  overrideBaseUrl: string | null;
  effectiveBaseUrl: string;
  saveOverride: (raw: string) => Promise<AgentEndpointParseResult>;
  clearOverride: () => Promise<void>;
};

const AgentEndpointContext = createContext<AgentEndpointSettings | null>(null);

function withHttpScheme(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
}

function stripKnownEndpointPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.replace(/\/(?:run|logline)$/i, '');
}

export function normalizeAgentBaseUrlInput(raw: string): AgentEndpointParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  let url: URL;
  try {
    url = new URL(withHttpScheme(trimmed));
  } catch {
    return { ok: false, reason: 'url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials' };
  }

  url.hash = '';
  url.search = '';
  url.pathname = stripKnownEndpointPath(url.pathname);
  return { ok: true, value: url.toString().replace(/\/+$/, '') };
}

export function buildAgentEndpoint(baseUrl: string, path: 'run' | 'logline'): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}`;
}

export function setInMemoryAgentBaseUrlOverride(baseUrl: string | null): void {
  inMemoryAgentBaseUrlOverride = baseUrl;
}

export function clearInMemoryAgentBaseUrlOverride(): void {
  setInMemoryAgentBaseUrlOverride(null);
}

export function getEffectiveAgentBaseUrl(): string {
  return inMemoryAgentBaseUrlOverride ?? DEFAULT_AGENT_BASE_URL;
}

export function runEndpoint(): string {
  return buildAgentEndpoint(getEffectiveAgentBaseUrl(), 'run');
}

export function loglineEndpoint(): string {
  return buildAgentEndpoint(getEffectiveAgentBaseUrl(), 'logline');
}

export async function saveAgentBaseUrlOverride(raw: string): Promise<AgentEndpointParseResult> {
  const parsed = normalizeAgentBaseUrlInput(raw);
  if (!parsed.ok) return parsed;
  await AsyncStorage.setItem(AGENT_ENDPOINT_STORAGE_KEY, parsed.value);
  setInMemoryAgentBaseUrlOverride(parsed.value);
  return parsed;
}

export async function loadAgentBaseUrlOverride(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(AGENT_ENDPOINT_STORAGE_KEY);
  if (!stored) return null;
  const parsed = normalizeAgentBaseUrlInput(stored);
  return parsed.ok ? parsed.value : null;
}

export async function clearAgentBaseUrlOverride(): Promise<void> {
  await AsyncStorage.removeItem(AGENT_ENDPOINT_STORAGE_KEY);
  clearInMemoryAgentBaseUrlOverride();
}

export function isAgentEndpointSettingsVisible(constants: ConstantsLike = Constants as ConstantsLike): boolean {
  if (constants.executionEnvironment === STANDALONE) return false;
  if (constants.executionEnvironment === STORE_CLIENT) return true;
  return constants.appOwnership === 'expo' || (typeof __DEV__ !== 'undefined' && __DEV__);
}

export function AgentEndpointProvider({ children }: { children: React.ReactNode }) {
  const visible = isAgentEndpointSettingsVisible();
  const [ready, setReady] = useState(false);
  const [overrideBaseUrl, setOverrideBaseUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!visible) {
      clearInMemoryAgentBaseUrlOverride();
      setOverrideBaseUrl(null);
      setReady(true);
      return () => {
        mounted = false;
      };
    }

    loadAgentBaseUrlOverride()
      .then((stored) => {
        if (!mounted) return;
        setInMemoryAgentBaseUrlOverride(stored);
        setOverrideBaseUrl(stored);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setReady(true);
      });

    return () => {
      mounted = false;
    };
  }, [visible]);

  const saveOverride = useCallback(async (raw: string) => {
    const parsed = await saveAgentBaseUrlOverride(raw);
    if (parsed.ok) setOverrideBaseUrl(parsed.value);
    return parsed;
  }, []);

  const clearOverride = useCallback(async () => {
    await clearAgentBaseUrlOverride();
    setOverrideBaseUrl(null);
  }, []);

  const api = useMemo<AgentEndpointSettings>(
    () => ({
      ready,
      visible,
      defaultBaseUrl: DEFAULT_AGENT_BASE_URL,
      overrideBaseUrl,
      effectiveBaseUrl: overrideBaseUrl ?? DEFAULT_AGENT_BASE_URL,
      saveOverride,
      clearOverride,
    }),
    [ready, visible, overrideBaseUrl, saveOverride, clearOverride],
  );

  return <AgentEndpointContext.Provider value={api}>{children}</AgentEndpointContext.Provider>;
}

export function useAgentEndpointSettings(): AgentEndpointSettings {
  const ctx = useContext(AgentEndpointContext);
  if (!ctx) throw new Error('useAgentEndpointSettings 必须在 AgentEndpointProvider 内使用');
  return ctx;
}
