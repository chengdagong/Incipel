// 验证「每轮都要有简短总结」这条 prompt 约束:在一个强接管措辞下跑一轮,
// 输出 JSON —— 模型是否既通过工具写了内容(toolDeltas),又给了非空的回复文本(replyText)。
//
// 跑法:CASE_MESSAGE="...你的强接管指令..." pnpm --filter @incipel/agent exec tsx src/dev/verify-summary.ts
// 或直接:CASE_MESSAGE="..." node_modules/.bin/tsx src/dev/verify-summary.ts
// 读 packages/agent/.env 的 OPENROUTER_API_KEY;缺 key 输出 {skipped:true} 并以 0 退出。

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { EventType, OPTIONS_EVENT_NAME, type JsonPatchOp } from '@incipel/shared';
import { createMastraProvider } from '../model/mastra';
import { runTurnCore } from '../run';
import { MemoryStore } from './memory-store';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

const message =
  process.env.CASE_MESSAGE ||
  '直接帮我把这个开头立起来:一个怕黑的灯塔看守人。给 logline、两个核心人物、一句标题,别问我。';

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ skipped: true, reason: 'no OPENROUTER_API_KEY' }));
    return;
  }

  const provider = createMastraProvider();
  const store = new MemoryStore();
  await store.createSessionIfMissing({ threadId: 'verify', userId: 'verify' });

  let replyText = '';
  const toolDeltas: string[] = [];
  let optionsCount = 0;
  let runError: string | null = null;

  for await (const ev of runTurnCore(
    { threadId: 'verify', runId: 'verify-run', userId: 'verify', userMessage: message, newConnection: true },
    { provider, store },
  )) {
    const e = ev as Record<string, unknown>;
    if (e.type === EventType.TEXT_MESSAGE_CONTENT) {
      replyText += String(e.delta ?? '');
    } else if (e.type === EventType.STATE_DELTA) {
      for (const d of ((e.delta as JsonPatchOp[]) ?? [])) toolDeltas.push(`${d.op} ${d.path}`);
    } else if (e.type === EventType.CUSTOM && e.name === OPTIONS_EVENT_NAME) {
      optionsCount = ((e.value as string[]) ?? []).length;
    } else if (e.type === EventType.RUN_ERROR) {
      runError = String(e.message ?? 'error');
    }
  }

  const meaningfulDeltas = toolDeltas.filter((p) => !p.endsWith('/meta/updatedAt'));
  const trimmed = replyText.trim();

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        skipped: false,
        runError,
        message,
        replyText: trimmed,
        replyLen: trimmed.length,
        hasSummary: trimmed.length > 0,
        toolDeltaCount: meaningfulDeltas.length,
        toolDeltas: meaningfulDeltas,
        optionsCount,
      },
      null,
      2,
    ),
  );
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
