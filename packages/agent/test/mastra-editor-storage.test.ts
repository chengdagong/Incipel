import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { MastraEditor } from '@mastra/editor';
import { describe, expect, it } from 'vitest';
import {
  createMastraAgents,
  prepareMastraStudioEditor,
  type IncipelMastraApp,
} from '../src/mastra';
import type { ModelRuntimeConfig } from '../src/model/config';
import { buildScreenwriterInstructions } from '../src/prompt';

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

function createEditorMastra() {
  return new Mastra({
    agents: createMastraAgents(config()),
    editor: new MastraEditor(),
    storage: new InMemoryStore({ id: 'incipel-editor-storage-test' }),
  }) as IncipelMastraApp;
}

function expectStudioScreenwriterTools(tools: unknown) {
  expect(tools).toEqual(
    expect.objectContaining({
      add_character: {},
      read_studio_screenplay: {},
      request_mckee_story_critique: {},
      openrouter_web_search: {},
      openrouter_web_fetch: {},
    }),
  );
}

describe('prepareMastraStudioEditor', () => {
  it('为 code-defined Studio agent 创建 Editor storage record,让 prompt 能保存、发布,并显示 tools', async () => {
    const mastra = createEditorMastra();
    const editor = mastra.getEditor()!;
    const agentsStore = (await mastra.getStorage()!.getStore('agents'))!;
    const agentId = 'incipel-studio-screenwriter';

    await expect(
      editor.agent.update({
        id: agentId,
        instructions: 'Draft prompt before record exists.',
      }),
    ).rejects.toThrow(`Agent with id ${agentId} not found`);

    await prepareMastraStudioEditor(mastra);
    await prepareMastraStudioEditor(mastra);

    const seeded = await agentsStore.getByIdResolved(agentId, { status: 'draft' });
    expect(seeded).toMatchObject({
      id: agentId,
      name: 'Incipel Studio Screenwriter',
      model: {
        provider: 'openrouter',
        name: 'openai/gpt-test',
      },
    });
    expectStudioScreenwriterTools(seeded?.tools);

    const updatedInstructions = 'Draft prompt saved from Mastra Studio.';
    await editor.agent.update({
      id: agentId,
      instructions: updatedInstructions,
    });

    const draft = await agentsStore.getByIdResolved(agentId, { status: 'draft' });
    expect(draft?.instructions).toBe(updatedInstructions);
    expectStudioScreenwriterTools(draft?.tools);

    const latestVersion = await agentsStore.getLatestVersion(agentId);
    expect(latestVersion?.instructions).toBe(updatedInstructions);

    await editor.agent.update({
      id: agentId,
      activeVersionId: latestVersion!.id,
      status: 'published',
    });

    const publishedRecord = await agentsStore.getById(agentId);
    expect(publishedRecord).toMatchObject({
      id: agentId,
      status: 'published',
      activeVersionId: latestVersion!.id,
    });

    const published = await agentsStore.getByIdResolved(agentId, { status: 'published' });
    expect(published?.instructions).toBe(updatedInstructions);
    expectStudioScreenwriterTools(published?.tools);
  });

  it('补写旧 seed record 缺失的 tools,且不会重复创建版本', async () => {
    const mastra = createEditorMastra();
    const editor = mastra.getEditor()!;
    const agentsStore = (await mastra.getStorage()!.getStore('agents'))!;
    const agentId = 'incipel-studio-screenwriter';

    await editor.agent.create({
      id: agentId,
      name: 'Incipel Studio Screenwriter',
      instructions: buildScreenwriterInstructions(),
      model: {
        provider: 'openrouter',
        name: 'openai/gpt-test',
      },
      metadata: {
        source: 'code',
        registrationName: 'studio-screenwriter',
      },
    });

    await prepareMastraStudioEditor(mastra);
    await prepareMastraStudioEditor(mastra);

    const repaired = await agentsStore.getByIdResolved(agentId, { status: 'draft' });
    const versions = await agentsStore.listVersions({ agentId, perPage: false });
    expect(repaired?.instructions).toBe(buildScreenwriterInstructions());
    expectStudioScreenwriterTools(repaired?.tools);
    expect(versions.versions).toHaveLength(2);
  });

  it('补写已经编辑过 prompt 的旧 seed record 时保留 prompt', async () => {
    const mastra = createEditorMastra();
    const editor = mastra.getEditor()!;
    const agentsStore = (await mastra.getStorage()!.getStore('agents'))!;
    const agentId = 'incipel-studio-screenwriter';

    await editor.agent.create({
      id: agentId,
      name: 'Incipel Studio Screenwriter',
      instructions: 'Custom prompt from Studio.',
      model: {
        provider: 'openrouter',
        name: 'openai/gpt-test',
      },
      metadata: {
        source: 'code',
        registrationName: 'studio-screenwriter',
      },
    });

    await prepareMastraStudioEditor(mastra);

    const preserved = await agentsStore.getByIdResolved(agentId, { status: 'draft' });
    expect(preserved?.instructions).toBe('Custom prompt from Studio.');
    expectStudioScreenwriterTools(preserved?.tools);
  });

  it('stored tools 只用于 Studio 展示,不会替换 runtime code-defined tools', async () => {
    const mastra = createEditorMastra();
    const editor = mastra.getEditor()!;
    const agentId = 'incipel-studio-screenwriter';

    await editor.agent.create({
      id: agentId,
      name: 'Incipel Studio Screenwriter',
      instructions: buildScreenwriterInstructions(),
      model: {
        provider: 'openrouter',
        name: 'openai/gpt-test',
      },
      tools: {
        stale_tool_from_storage: {},
      },
      metadata: {
        source: 'code',
        registrationName: 'studio-screenwriter',
      },
    });

    const runtimeAgent = await editor.agent.update({
      id: agentId,
      instructions: 'Custom prompt from Studio.',
    });

    const runtimeTools = await runtimeAgent.listTools();
    expect(runtimeTools).toEqual(
      expect.objectContaining({
        read_studio_screenplay: expect.anything(),
        request_mckee_story_critique: expect.anything(),
        openrouter_web_search: expect.anything(),
        openrouter_web_fetch: expect.anything(),
      }),
    );
    expect(runtimeTools).not.toHaveProperty('stale_tool_from_storage');
  });
});
