// 冒烟脚本:用真实 OpenRouter provider + 内存 store 跑几条真实回合,验证核心循环可跑、结构不变量成立。
//
// 跑法:pnpm --filter @incipel/agent smoke(发版前 / 夜间手动跑;真实模型不进 E2E,见 ADR-0007 Q2)
// 需要 packages/agent/.env 里有 OPENROUTER_API_KEY(以及可选 OPENROUTER_MODEL)。
// 缺失 key 时打印提示并以 0 退出(不算失败)——见任务说明:缺失不算失败。
//
// 它复用 run.ts 的 runTurnCore(注入 { provider, store }),与 /run 同一条核心循环:
//   buildPrompt → provider.streamTurn(带 buildToolSchemas)→ 收集文本 + 工具调用
//   → apply → JsonPatch deltas → save_turn(内存)。
//
// 覆盖几个不同题材的灵感,逐条断言同一组结构不变量(真实模型每轮产出会变,但这些不变量应恒成立):
//   RUN_STARTED / RUN_FINISHED(无 RUN_ERROR)、至少一次有效工具调用被应用、最终剧本非空、
//   update/remove 命中的实体 id 合法。流式文本是期望而非硬性保证(模型可能纯接管、不说话)。

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  EventType,
  OPTIONS_EVENT_NAME,
  type JsonPatchOp,
  type Screenplay,
} from '@incipel/shared';
import { createOpenRouterProvider } from '../model/openrouter';
import { runTurnCore } from '../run';
import type { ModelProvider } from '../model/provider';
import { MemoryStore } from './memory-store';

// 从 packages/agent/.env 读取(脚本在 src/dev/ 下,上溯两级到包根)。
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

const USER_ID = 'smoke-user';

// 不同题材的灵感:横跨末日 / 校园悬疑 / 科幻 / 古装,压「结构不变量与题材无关」。
const INSPIRATIONS: { label: string; userMessage: string }[] = [
  {
    label: '末日废土',
    userMessage:
      '我想写一个发生在末日废土上的故事:一个曾经的外科医生,如今靠给幸存者治病换取物资。帮我把这个开头立起来——给个 logline,搭两个核心人物,再起个标题。',
  },
  {
    label: '校园悬疑',
    userMessage:
      '一个总在重要考试前梦见三天后才发生的事的高中生。把这个开头立起来:给 logline、起标题、立两个核心人物。',
  },
  {
    label: '科幻',
    userMessage:
      '一艘飞了两百年的世代飞船,某天醒来只剩 AI 管家还清醒,全船乘客都在休眠舱里。帮我搭好开头:logline、标题、两个核心人物。',
  },
  {
    label: '古装宫廷',
    userMessage:
      '一个负责给皇帝试毒的小吏,某天尝出毒来却选择不报。把这个开头立起来:logline、标题、两个核心人物。',
  },
];

function ok(label: string, pass: boolean): boolean {
  // eslint-disable-next-line no-console
  console.log(`  ${pass ? '✓' : '✗'} ${label}`);
  return pass;
}

// 跑一条灵感并断言结构不变量;返回是否全过。
async function runOne(
  provider: ModelProvider,
  index: number,
  insp: { label: string; userMessage: string },
): Promise<boolean> {
  const threadId = `smoke-thread-${index}`;
  const store = new MemoryStore();
  await store.createSessionIfMissing({ threadId, userId: USER_ID });

  let assistantText = '';
  const allDeltas: JsonPatchOp[] = [];
  let options: string[] = [];
  let runStarted = false;
  let runFinished = false;
  let runError: string | null = null;
  let snapshot: Screenplay | null = null;

  // eslint-disable-next-line no-console
  console.log(`\n=== [${index + 1}/${INSPIRATIONS.length}] ${insp.label} ===\n--- 流式回复 ---`);

  for await (const event of runTurnCore(
    { threadId, runId: `smoke-run-${index}`, userId: USER_ID, userMessage: insp.userMessage, newConnection: true },
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
    console.error(`  ✗ RUN_ERROR: ${runError}`);
    return false;
  }

  const saved = store.lastSaved;
  const finalState = saved?.state ?? snapshot;

  // 模型对剧本的改动一览(由 STATE_DELTA 推断)+ options。
  const changedPaths = allDeltas.filter((d) => d.path !== '/meta/updatedAt').map((d) => `${d.op} ${d.path}`);
  // eslint-disable-next-line no-console
  console.log(`  改动 ${changedPaths.length} 处${changedPaths.length ? ': ' + changedPaths.slice(0, 8).join(', ') + (changedPaths.length > 8 ? ' …' : '') : ''}`);
  if (options.length) {
    // eslint-disable-next-line no-console
    console.log(`  options: ${options.join(' | ')}`);
  }

  // ── 断言结构不变量 ────────────────────────────────────────────────────────
  let pass = true;
  pass = ok('RUN_STARTED 已发出', runStarted) && pass;
  pass = ok('RUN_FINISHED 已发出(无 RUN_ERROR)', runFinished) && pass;
  if (assistantText.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.log('  · (提示)本轮无流式文本:模型直接接管写内容,未输出对话文字');
  } else {
    ok('收到流式文本', true);
  }

  const meaningfulDeltas = allDeltas.filter((d) => d.path !== '/meta/updatedAt');
  pass = ok('至少一次有效工具调用被应用(产生 STATE_DELTA)', meaningfulDeltas.length > 0) && pass;

  if (!finalState) {
    pass = ok('最终剧本存在', false) && pass;
  } else {
    const nonEmpty =
      finalState.world.length > 0 ||
      finalState.characters.length > 0 ||
      finalState.outline.length > 0 ||
      finalState.scenes.length > 0 ||
      Boolean(finalState.meta.title) ||
      Boolean(finalState.meta.logline);
    pass = ok('最终剧本非空', nonEmpty) && pass;
    pass = ok('update/remove 命中的实体 id 合法', checkDeltaIdsLegit(allDeltas, finalState)) && pass;
  }
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
  let allPass = true;
  for (const [i, insp] of INSPIRATIONS.entries()) {
    const pass = await runOne(provider, i, insp);
    allPass = pass && allPass;
  }

  if (!allPass) {
    // eslint-disable-next-line no-console
    console.error('\n[smoke] 有灵感的断言未通过。');
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n[smoke] ${INSPIRATIONS.length} 条灵感全部结构断言通过。`);
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
    if (d.op === 'replace' && idx >= size) return false;
  }
  return true;
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[smoke] 未捕获错误:', err);
  process.exitCode = 1;
});
