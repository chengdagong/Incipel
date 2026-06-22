// 真实一轮 fixture 经 stub 确定性回放(见 ADR-0007 Q2 (C))。
// 把「贴近真实模型那种更乱」的产出喂进 runTurnCore,断言 apply / save 这条数据契约不被搞坏:
// 管线跑通、文本不截断、各集合数量对、服务端给每个实体生成唯一非空 id、乱内容原样幸存进最终剧本。
// 这是客户端渲染所依赖的状态形状;客户端 UI 渲染本身的测试待 RN 测试 harness(见 fixtures/real-turns.ts)。

import { describe, it, expect } from 'vitest';
import { EventType } from '@incipel/shared';
import { runTurnCore } from '../src/run';
import { MemoryStore } from '../src/dev/memory-store';
import type { StreamChunk } from '../src/model/provider';
import { stubProvider } from './helpers/stub-provider';
import { TURN_FIXTURES } from './fixtures/real-turns';

type Ev = Record<string, any>;

function isTool(c: StreamChunk): c is Extract<StreamChunk, { type: 'tool-call' }> {
  return c.type === 'tool-call';
}
function countTool(script: StreamChunk[], name: string): number {
  return script.filter((c) => isTool(c) && c.call.toolName === name).length;
}
function joinText(script: StreamChunk[]): string {
  return script
    .filter((c): c is Extract<StreamChunk, { type: 'text' }> => c.type === 'text')
    .map((c) => c.delta)
    .join('');
}

describe('真实一轮 fixture 经 stub 确定性回放(数据契约不被乱产出搞坏)', () => {
  for (const fx of TURN_FIXTURES) {
    it(`${fx.name}: ${fx.note}`, async () => {
      const store = new MemoryStore();
      await store.createSessionIfMissing({ threadId: 't', userId: 'u' });

      const events: Ev[] = [];
      for await (const e of runTurnCore(
        { threadId: 't', runId: 'r', userId: 'u', userMessage: fx.userMessage, newConnection: true },
        { provider: stubProvider([fx.script]), store },
      )) {
        events.push(e as Ev);
      }
      const types = events.map((e) => e.type);

      // 管线跑通,无错。
      expect(types).toContain(EventType.RUN_FINISHED);
      expect(types).not.toContain(EventType.RUN_ERROR);

      const saved = store.lastSaved!;
      expect(saved).toBeTruthy();

      // 文本原样拼接(超长也不截断)。
      expect(saved.assistantText).toBe(joinText(fx.script));

      // 各集合数量 = 该轮 add_* 次数(propose_options 不进剧本)。
      expect(saved.state.world).toHaveLength(countTool(fx.script, 'add_world_section'));
      expect(saved.state.characters).toHaveLength(countTool(fx.script, 'add_character'));
      expect(saved.state.outline).toHaveLength(countTool(fx.script, 'add_act'));
      expect(saved.state.scenes).toHaveLength(countTool(fx.script, 'add_scene'));

      // options = propose_options 的参数(最多 3;无则空)。
      const optCall = fx.script.find((c) => isTool(c) && c.call.toolName === 'propose_options') as
        | Extract<StreamChunk, { type: 'tool-call' }>
        | undefined;
      if (optCall) {
        const opts = (optCall.call.args as { options: string[] }).options;
        expect(saved.options).toEqual(opts.slice(0, 3));
      } else {
        expect(saved.options).toEqual([]);
      }

      // 服务端为每个实体生成了唯一非空 id(客户端 diff / testID 依赖 id)。
      const ids = [
        ...saved.state.world.map((w) => w.id),
        ...saved.state.characters.map((c) => c.id),
        ...saved.state.characters.flatMap((c) => c.attrs.map((a) => a.id)),
        ...saved.state.outline.map((o) => o.id),
        ...saved.state.scenes.map((s) => s.id),
      ];
      for (const id of ids) expect(id).toMatch(/.+/);
      expect(new Set(ids).size).toBe(ids.length);

      // 内容探针:乱产出原样幸存进最终剧本(emoji / 组合符 / 空白邻接都不丢、不乱码)。
      const blob = JSON.stringify(saved.state);
      for (const p of fx.probes) expect(blob).toContain(p);
    });
  }
});
