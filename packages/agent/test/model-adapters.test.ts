// 模型适配器工厂(testing-strategy §3.6):只测「缺 key 抛错」——其余是框架接线,不测。

import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

describe('model adapters — 缺 key 即拒', () => {
  it('createAnthropicProvider 缺 ANTHROPIC_API_KEY → 抛错', async () => {
    const { createAnthropicProvider } = await import('../src/model/anthropic');
    expect(() => createAnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('createOpenRouterProvider 缺 OPENROUTER_API_KEY → 抛错', async () => {
    const { createOpenRouterProvider } = await import('../src/model/openrouter');
    expect(() => createOpenRouterProvider()).toThrow(/OPENROUTER_API_KEY/);
  });

  it('有 key 时构造不抛错', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { createAnthropicProvider } = await import('../src/model/anthropic');
    expect(() => createAnthropicProvider()).not.toThrow();
  });
});
