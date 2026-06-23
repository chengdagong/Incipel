import { describe, it, expect, beforeEach } from 'vitest';

const MODEL_ENV_KEYS = [
  'MODEL_PROVIDER',
];

beforeEach(() => {
  for (const key of MODEL_ENV_KEYS) delete process.env[key];
});

describe('model config', () => {
  it('默认从 packages/agent/model.config.json 读取 OpenRouter 配置', async () => {
    const { getModelConfig } = await import('../src/model/config');
    const config = getModelConfig();

    expect(config.provider).toBe('openrouter');
    expect(config.turn.model).toBe('openai/gpt-5.1:nitro');
    expect(config.turn.temperature).toBeUndefined();
    expect(config.turn.reasoning).toEqual({ enabled: false });
    expect(config.logline.model).toBe('openai/gpt-5.1:nitro');
    expect(config.logline.temperature).toBe(0.5);
    expect(config.logline.reasoning).toEqual({ enabled: false });
  });

  it('MODEL_PROVIDER 只选择 provider,模型参数仍来自 JSON', async () => {
    process.env.MODEL_PROVIDER = 'openrouter';

    const { getModelConfig } = await import('../src/model/config');
    const config = getModelConfig();

    expect(config.provider).toBe('openrouter');
    expect(config.turn.model).toBe('openai/gpt-5.1:nitro');
    expect(config.logline.model).toBe('openai/gpt-5.1:nitro');
  });

  it('resolveModelConfig 可读取传入 JSON 对象里的模型参数', async () => {
    const { resolveModelConfig } = await import('../src/model/config');
    const config = resolveModelConfig(
      {
        selected_provider: 'openrouter',
        turn: {
          openrouter: {
            model: 'claude-custom-turn',
            temperature: 0.2,
            reasoning: { enabled: true, effort: 'high', budgetTokens: 2048 },
          },
          stub: { model: 'stub-turn', reasoning: { enabled: false } },
        },
        logline: {
          openrouter: {
            model: 'claude-custom-logline',
            temperature: 0.8,
            reasoning: { enabled: false },
          },
          stub: { model: 'stub-logline', reasoning: { enabled: false } },
        },
      },
      'openrouter',
    );

    expect(config.turn).toEqual({
      model: 'claude-custom-turn',
      temperature: 0.2,
      reasoning: { enabled: true, effort: 'high', budgetTokens: 2048 },
    });
    expect(config.logline).toEqual({
      model: 'claude-custom-logline',
      temperature: 0.8,
      reasoning: { enabled: false },
    });
  });

  it('JSON 里只设置 reasoning effort 时会自动开启 reasoning', async () => {
    const { resolveModelConfig } = await import('../src/model/config');
    const config = resolveModelConfig(
      {
        selected_provider: 'openrouter',
        turn: {
          openrouter: { model: 'openrouter-turn', reasoning: { enabled: false } },
          stub: { model: 'stub-turn', reasoning: { enabled: false } },
        },
        logline: {
          openrouter: { model: 'openrouter-logline', reasoning: { effort: 'low' } },
          stub: { model: 'stub-logline', reasoning: { enabled: false } },
        },
      },
      'openrouter',
    );

    expect(config.logline.reasoning).toEqual({ enabled: true, effort: 'low' });
  });

  it('OpenRouter reasoning 转成 reasoning providerOptions', async () => {
    const { providerOptionsForUse } = await import('../src/model/config');

    expect(
      providerOptionsForUse('openrouter', {
        model: 'openrouter-test',
        reasoning: { enabled: true, effort: 'high' },
      }),
    ).toEqual({ openrouter: { reasoning: { enabled: true, effort: 'high' } } });
  });

  it('JSON 里的无效配置会直接报错', async () => {
    const { resolveModelConfig } = await import('../src/model/config');

    expect(() =>
      resolveModelConfig({
        selected_provider: 'openrouter',
        turn: {
          openrouter: { model: 'openrouter-turn', reasoning: { enabled: false } },
          stub: { model: 'stub-turn', reasoning: { enabled: false } },
        },
        logline: {
          openrouter: { model: 'openrouter-logline', temperature: 'hot' as unknown as number },
          stub: { model: 'stub-logline', reasoning: { enabled: false } },
        },
      }),
    ).toThrow(/model\.config\.json logline\.openrouter\.temperature/);
  });

  it('MODEL_PROVIDER=anthropic 会被拒绝', async () => {
    process.env.MODEL_PROVIDER = 'anthropic';

    const { getModelConfig } = await import('../src/model/config');

    expect(() => getModelConfig()).toThrow(/MODEL_PROVIDER: anthropic/);
  });
});
