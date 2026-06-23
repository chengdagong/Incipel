// 模型适配器工厂(testing-strategy §3.6):只测「缺 key 抛错」——其余是框架接线,不测。

import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  delete process.env.MODEL_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
});

describe('model adapters — 缺 key 即拒', () => {
  it('createOpenRouterProvider 缺 OPENROUTER_API_KEY → 抛错', async () => {
    const { createOpenRouterProvider } = await import('../src/model/openrouter');
    expect(() => createOpenRouterProvider()).toThrow(/OPENROUTER_API_KEY/);
  });

  it('有 key 时构造不抛错', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const { createOpenRouterProvider } = await import('../src/model/openrouter');
    expect(() => createOpenRouterProvider()).not.toThrow();
  });
});
