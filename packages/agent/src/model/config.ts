import rawModelConfig from '../../model.config.json' with { type: 'json' };
import { env } from '../env.ts';

export type ProviderName = 'openrouter' | 'stub';
export type ModelKind = 'turn' | 'logline';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

export type ReasoningConfig =
  | { enabled: false }
  | { enabled: true; effort?: ReasoningEffort; budgetTokens?: number };

export type ModelUseConfig = {
  model: string;
  temperature?: number;
  reasoning: ReasoningConfig;
};

export type ModelRuntimeConfig = {
  provider: ProviderName;
  turn: ModelUseConfig;
  logline: ModelUseConfig;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ModelProviderOptions = Record<string, Record<string, JsonValue>>;

type RawReasoningConfig = {
  enabled?: boolean;
  effort?: ReasoningEffort;
  budgetTokens?: number;
};

type RawModelUseConfig = {
  model: string;
  temperature?: number;
  reasoning?: RawReasoningConfig;
};

type RawModelConfig = {
  selected_provider: ProviderName;
  turn: Record<ProviderName, RawModelUseConfig>;
  logline: Record<ProviderName, RawModelUseConfig>;
};

export function getModelConfig(providerOverride?: ProviderName): ModelRuntimeConfig {
  return resolveModelConfig(rawModelConfig as RawModelConfig, providerOverride ?? readProvider());
}

export function resolveModelConfig(
  raw: RawModelConfig,
  provider: ProviderName = raw.selected_provider,
): ModelRuntimeConfig {
  return {
    provider,
    turn: readUseConfig(raw, 'turn', provider),
    logline: readUseConfig(raw, 'logline', provider),
  };
}

export function providerOptionsForUse(
  provider: ProviderName,
  useConfig: ModelUseConfig,
): ModelProviderOptions | undefined {
  if (!useConfig.reasoning.enabled) return undefined;

  if (provider === 'openrouter') {
    const reasoning: Record<string, JsonValue> =
      useConfig.reasoning.budgetTokens === undefined
        ? { enabled: true, effort: useConfig.reasoning.effort ?? 'medium' }
        : { enabled: true, max_tokens: useConfig.reasoning.budgetTokens };
    return { openrouter: { reasoning } };
  }

  return undefined;
}

function readProvider(): ProviderName {
  const raw = env('MODEL_PROVIDER') ?? (rawModelConfig as RawModelConfig).selected_provider;
  if (raw === 'openrouter' || raw === 'stub') return raw;
  throw new Error(`未知或不被支持的 MODEL_PROVIDER: ${raw}`);
}

function readUseConfig(raw: RawModelConfig, kind: ModelKind, provider: ProviderName): ModelUseConfig {
  const useConfig = raw[kind]?.[provider];
  if (!useConfig) {
    throw new Error(`model.config.json 缺少 ${kind}.${provider} 配置`);
  }
  if (!useConfig.model) {
    throw new Error(`model.config.json 的 ${kind}.${provider}.model 不能为空`);
  }
  return {
    model: useConfig.model,
    temperature: readOptionalNumber(`model.config.json ${kind}.${provider}.temperature`, useConfig.temperature),
    reasoning: readReasoningConfig(useConfig.reasoning),
  };
}

function readReasoningConfig(raw: RawReasoningConfig | undefined): ReasoningConfig {
  const effort = readOptionalReasoningEffort('reasoning.effort', raw?.effort);
  const budgetTokens = readOptionalPositiveInteger('reasoning.budgetTokens', raw?.budgetTokens);
  const enabled = raw?.enabled ?? (effort !== undefined || budgetTokens !== undefined);

  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    ...(effort === undefined ? {} : { effort }),
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
  };
}

function readOptionalReasoningEffort(name: string, raw: unknown): ReasoningEffort | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'max') return raw;
  throw new Error(`${name} 必须是 low、medium、high 或 max`);
}

function readOptionalNumber(name: string, raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  throw new Error(`${name} 必须是数字`);
}

function readOptionalPositiveInteger(name: string, raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  throw new Error(`${name} 必须是正整数`);
}
