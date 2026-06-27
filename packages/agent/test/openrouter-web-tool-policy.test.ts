import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRuntimeConfig } from '../src/model/config';
import {
  OPENROUTER_WEB_FETCH_TOOL_NAME,
  OPENROUTER_WEB_SEARCH_TOOL_NAME,
} from '../src/mastra/tools/openrouter-tools';

function config(): ModelRuntimeConfig {
  return {
    provider: 'openrouter',
    turn: {
      model: 'openai/gpt-test',
      temperature: 0.2,
      reasoning: { enabled: true, effort: 'high' },
    },
    logline: {
      model: 'openai/gpt-logline',
      temperature: 0.5,
      reasoning: { enabled: false },
    },
  };
}

function openRouterSuccessResponse() {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'openai/gpt-test',
    provider: 'openai',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'ok',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  };
}

async function captureStudioScreenwriterRequest(prompt: string) {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test';
  vi.resetModules();

  const bodies: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(openRouterSuccessResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  try {
    const { createMastraAgents } = await import('../src/mastra');
    const mastra = new Mastra({
      agents: createMastraAgents(config()),
      storage: new InMemoryStore({ id: 'openrouter-web-tool-policy-test' }),
    });

    await mastra.getAgent('studio-screenwriter').generate(prompt, {
      maxSteps: 1,
      toolChoice: 'auto',
    });

    return bodies[0];
  } finally {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouter web server tool policy', () => {
  it('用户明确要求搜索或实时信息时,只暴露 OpenRouter web server tools 并要求模型调用工具', async () => {
    const body = await captureStudioScreenwriterRequest('搜索一下未来三天东京的天气');

    expect(body.tool_choice).toBe('required');
    expect(body.tools).toEqual([{ type: 'openrouter:web_search' }, { type: 'openrouter:web_fetch' }]);
  });

  it('普通创作请求不强制 web server tools', async () => {
    const body = await captureStudioScreenwriterRequest('帮我写一个雨天重逢的开场');

    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'set_meta' }),
        }),
        { type: 'openrouter:web_search' },
      ]),
    );
  });

  it('导出稳定的 OpenRouter web tool 名称', () => {
    expect(OPENROUTER_WEB_SEARCH_TOOL_NAME).toBe('openrouter_web_search');
    expect(OPENROUTER_WEB_FETCH_TOOL_NAME).toBe('openrouter_web_fetch');
  });
});
