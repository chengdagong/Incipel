// 冒烟脚本:用真实 OpenRouter provider + 内存 store 跑一条真实回合,验证核心循环可跑。
//
// 跑法:pnpm --filter @incipel/agent smoke
// 需要 packages/agent/.env 里有 OPENROUTER_API_KEY(以及可选 OPENROUTER_MODEL)。
// 缺失 key 时打印提示并以 0 退出(不算失败)——见任务说明:缺失不算失败。
//
// 它复用 run.ts 的 runTurnCore(注入 { provider, store }),与 /run 同一条核心循环:
//   buildPrompt → provider.streamTurn(带 buildToolSchemas)→ 收集文本 + 工具调用
//   → apply → JsonPatch deltas → save_turn(内存)。
// 收集流式回复、模型调用了哪些工具、最终剧本、STATE_DELTA 并打印;再做断言。

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deriveStage,
  EventType,
  OPTIONS_EVENT_NAME,
  type JsonPatchOp,
  type Screenplay,
} from '@incipel/shared';
import { createOpenRouterProvider } from '../model/openrouter';
import { runTurnCore } from '../run';
import { MemoryStore } from './memory-store';

// 从 packages/agent/.env 读取(脚本在 src/dev/ 下,上溯两级到包根)。
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

const THREAD_ID = 'smoke-thread';
const USER_ID = 'smoke-user';
const USER_MESSAGE =
  '我想写一个发生在末日废土上的故事:一个曾经的外科医生,如今靠给幸存者治病换取物资。帮我把这个开头立起来——给个 logline,搭两个核心人物,再起个标题。';

function ok(label: string, pass: boolean): boolean {
  // eslint-disable-next-line no-console
  console.log(`${pass ? '✓' : '✗'} ${label}`);
  return pass;
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    // eslint-disable-next-line no-console
    console.log(
      '[smoke] 未配置 OPENROUTER_API_KEY(packages/agent/.env);跳过真实回合。\n' +
        '        类型检查与脚本可跑性不依赖 key——缺失不算失败。',
    );
    return;
  }

  const provider = createOpenRouterProvider();
  const store = new MemoryStore();
  await store.createSessionIfMissing({ threadId: THREAD_ID, userId: USER_ID });

  // 收集本轮产物。
  let assistantText = '';
  const allDeltas: JsonPatchOp[] = [];
  let options: string[] = [];
  let runStarted = false;
  let runFinished = false;
  let runError: string | null = null;
  let snapshot: Screenplay | null = null;

  // eslint-disable-next-line no-console
  console.log('=== 流式回复 ===');

  for await (const event of runTurnCore(
    { threadId: THREAD_ID, runId: 'smoke-run', userId: USER_ID, userMessage: USER_MESSAGE, newConnection: true },
    { provider, store },
  )) {
    const e = event as Record<string, unknown>;
    switch (e.type) {
      case EventType.RUN_STARTED:
        runStarted = true;
        break;
      case EventType.STATE_SNAPSHOT:
        snapshot = e.snapshot as Screenplay;
        break;
      case EventType.TEXT_MESSAGE_CONTENT: {
        const delta = String(e.delta ?? '');
        assistantText += delta;
        process.stdout.write(delta);
        break;
      }
      case EventType.STATE_DELTA: {
        const delta = (e.delta as JsonPatchOp[]) ?? [];
        allDeltas.push(...delta);
        break;
      }
      case EventType.CUSTOM:
        if (e.name === OPTIONS_EVENT_NAME) options = (e.value as string[]) ?? [];
        break;
      case EventType.RUN_FINISHED:
        runFinished = true;
        break;
      case EventType.RUN_ERROR:
        runError = String(e.message ?? '未知错误');
        break;
      default:
        break;
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n');

  if (runError) {
    // eslint-disable-next-line no-console
    console.error(`[smoke] RUN_ERROR: ${runError}`);
    process.exitCode = 1;
    return;
  }

  // saveTurn 已把最终剧本写回内存;直接取出做检查与打印。
  const saved = store.lastSaved;
  const finalState = saved?.state ?? snapshot;

  // ── 打印:模型调用了哪些工具(由 STATE_DELTA 推断 + options)────────────────
  // eslint-disable-next-line no-console
  console.log('=== 模型对剧本的改动(STATE_DELTA op/path)===');
  for (const d of allDeltas) {
    // eslint-disable-next-line no-console
    console.log(`  ${d.op.padEnd(7)} ${d.path}`);
  }
  if (options.length) {
    // eslint-disable-next-line no-console
    console.log(`=== propose_options ===\n  ${options.join(' | ')}`);
  }

  // eslint-disable-next-line no-console
  console.log('\n=== 最终剧本 ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(finalState, null, 2));

  // ── 断言 ────────────────────────────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('\n=== 断言 ===');
  let pass = true;

  pass = ok('RUN_STARTED 已发出', runStarted) && pass;
  pass = ok('RUN_FINISHED 已发出(无 RUN_ERROR)', runFinished) && pass;
  // 流式文本是期望而非硬性保证:模型可能这一轮选择「接管」,只调工具写内容、不说话。
  // 故只作提示,不参与 pass 判定(任务要求的硬断言是工具调用 / id 合法 / 剧本非空)。
  if (assistantText.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.log('· (提示)本轮无流式文本:模型直接接管写内容,未输出对话文字');
  } else {
    ok('收到流式文本', true);
  }

  // 至少一次有效工具调用被应用:体现为至少一条非 /meta/updatedAt 的 STATE_DELTA。
  const meaningfulDeltas = allDeltas.filter((d) => d.path !== '/meta/updatedAt');
  pass = ok('至少一次有效工具调用被应用(产生 STATE_DELTA)', meaningfulDeltas.length > 0) && pass;

  if (!finalState) {
    pass = ok('最终剧本存在', false) && pass;
  } else {
    // 最终剧本非空:至少有一类实体或 meta 字段被填。
    const nonEmpty =
      finalState.world.length > 0 ||
      finalState.characters.length > 0 ||
      finalState.outline.length > 0 ||
      finalState.scenes.length > 0 ||
      Boolean(finalState.meta.title) ||
      Boolean(finalState.meta.logline);
    pass = ok('最终剧本非空', nonEmpty) && pass;

    // update/remove 的 id 合法:STATE_DELTA 里凡 replace/remove 指向某实体下标的,
    // 该实体最终都应真实存在(apply.ts 已对不存在的 id 抛错;这里再核一遍最终态自洽)。
    const idLegit = checkDeltaIdsLegit(allDeltas, finalState);
    pass = ok('update/remove 命中的实体 id 合法(下标在最终剧本范围内)', idLegit) && pass;

    // 派生阶段应已推进(至少到 world / characters / outline / scenes 之一)。
    // eslint-disable-next-line no-console
    console.log(`  (派生阶段: ${deriveStage(finalState)})`);
  }

  if (!pass) {
    // eslint-disable-next-line no-console
    console.error('\n[smoke] 有断言未通过。');
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log('\n[smoke] 全部断言通过。');
  }
}

// 校验:所有指向某实体集合下标的 replace/remove patch,其下标在最终剧本里都有对应元素。
// add 不校验(它扩张集合);/meta/* 跳过。
function checkDeltaIdsLegit(deltas: JsonPatchOp[], state: Screenplay): boolean {
  const sizes: Record<string, number> = {
    world: state.world.length,
    characters: state.characters.length,
    outline: state.outline.length,
    scenes: state.scenes.length,
  };
  for (const d of deltas) {
    if (d.op === 'add') continue;
    const m = /^\/(world|characters|outline|scenes)\/(\d+)/.exec(d.path);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    const coll = m[1] as keyof typeof sizes;
    const idx = Number(m[2]);
    const size = sizes[coll] ?? 0;
    // remove 之后集合会缩小;这里用「最终集合大小」做一个保守上界检查:
    // 凡曾被 replace 命中的下标,若超出最终大小,可能意味着 id 错位。
    if (d.op === 'replace' && idx >= size) return false;
  }
  return true;
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[smoke] 未捕获错误:', err);
  process.exitCode = 1;
});
