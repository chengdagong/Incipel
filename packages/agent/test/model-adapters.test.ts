// 模型适配器工厂(testing-strategy §3.6):只测密钥检查与默认 runtime 选择。

import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  delete process.env.MODEL_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
});

describe('model adapters — Mastra runtime', () => {
  it('createMastraProvider 缺 OPENROUTER_API_KEY → 抛错', async () => {
    const { createMastraProvider } = await import('../src/model/mastra');
    expect(() => createMastraProvider()).toThrow(/OPENROUTER_API_KEY/);
  });

  it('createModelProvider 默认返回 Mastra-backed provider', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const { createModelProvider } = await import('../src/model/provider');

    await expect(createModelProvider()).resolves.toMatchObject({
      streamTurn: expect.any(Function),
      completeLogline: expect.any(Function),
    });
  });

  it('MODEL_PROVIDER=stub 仍返回确定性本地 provider', async () => {
    process.env.MODEL_PROVIDER = 'stub';
    const { createModelProvider } = await import('../src/model/provider');

    const provider = await createModelProvider();

    await expect(provider.completeLogline({ prompt: 'p' })).resolves.toBe(
      '一个深夜便利店店员,发现每位顾客都在重复同一天。',
    );
  });
});
