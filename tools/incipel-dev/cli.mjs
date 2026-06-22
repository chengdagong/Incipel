#!/usr/bin/env node
// incipel-dev —— 本仓库的开发命令行工具(见 docs/adr/0007)。
//
// agent 唯一运行时是 Supabase Edge Function,本地开发与 E2E 都在 Supabase 的 edge runtime 上跑。
// 这个工具接手原来 dev-agent.sh / worktree-dev-env.sh 里 agent 相关的职责:写好各处环境变量、
// 起共用栈并 serve agent,以及为 E2E 生成「每 worktree 一套」的隔离栈(派生 project_id + 错开
// 端口 + --workdir)。选 Node 而非 bash:生成 per-worktree config.toml 要改 TOML、做符号链接,
// bash 做这些易错。
//
// 零运行时依赖,纯 ESM。所有会改文件 / 起进程的动作都遵守 --dry-run:只打印不执行。
//
//   node tools/incipel-dev/cli.mjs <command> [--dry-run]
//
//   dev              起共用栈(若未起)+ 同步 env + serve agent(前台,带热重载日志)
//   up               起共用栈(若未起)+ 同步 env + 后台 serve agent(不阻塞;dev:ios/android 会调它)
//   env [sync]       只同步 env:写 apps/mobile/.env 的 EXPO_PUBLIC_*、确保 supabase/.env 模板
//   e2e up           生成隔离 workdir + supabase start --workdir,打印该栈的 URL
//   e2e down         supabase stop --workdir + 清理 workdir
//   help

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 管道被下游(如 `| head`)提前关闭时,别让 EPIPE 把进程打成未捕获异常。
process.stdout.on('error', (e) => {
  if (e && e.code === 'EPIPE') process.exit(0);
  throw e;
});

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const args = argv.filter((a) => a !== '--dry-run');
const [cmd, sub] = args;

// ── 小工具 ────────────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}
// 跑命令;mutate=true 的命令在 --dry-run 下只打印。返回 { code, stdout }。
function run(bin, cmdArgs, { mutate = true, capture = false, cwd } = {}) {
  const shown = `${bin} ${cmdArgs.join(' ')}`;
  if (mutate && DRY) {
    log(`  [dry-run] ${shown}`);
    return { code: 0, stdout: '' };
  }
  const res = spawnSync(bin, cmdArgs, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? '' };
}
function repoRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status !== 0) fail('不在 git 仓库内(git rev-parse --show-toplevel 失败)');
  return res.stdout.trim();
}
// 本 worktree 的稳定短 hash(派生 project_id 与端口偏移用)。
function worktreeHash(root) {
  return createHash('sha1').update(root).digest('hex').slice(0, 8);
}
// 替换/追加 .env 文件里的一行(整行前缀匹配);--dry-run 下只打印。
function setEnvVar(file, key, val) {
  if (DRY) {
    log(`  [dry-run] set ${key}=${val}  (${file})`);
    return;
  }
  let lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  let found = false;
  lines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${val}`;
    }
    return line;
  });
  if (!found) {
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 1);
    lines.push(`${key}=${val}`);
    lines.push('');
  }
  writeFileSync(file, lines.join('\n'));
  log(`  set ${key}=${val}  (${file})`);
}
// 从 config.toml 读某 section 下某 key 的整数(如 [api] port)。
function tomlInt(toml, section, key) {
  const lines = toml.split('\n');
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) inSection = line === `[${section}]`;
    else if (inSection) {
      const m = line.match(new RegExp(`^${key}\\s*=\\s*(\\d+)`));
      if (m) return Number(m[1]);
    }
  }
  return null;
}

// 共用栈(canonical config.toml)的 API 端口:日常 dev 的 edge URL 用它。
function canonicalApiPort(root) {
  const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  return tomlInt(toml, 'api', 'port') ?? 54521;
}

// ── env sync:把 agent 路由相关的 env 写到位 ──────────────────────────────────
// agent 已不再是本地 Node 服务,客户端一律指向 edge function:`<api>/functions/v1/agent`。
function envSync(root) {
  const apiPort = canonicalApiPort(root);
  const agentUrl = `http://127.0.0.1:${apiPort}/functions/v1/agent`;
  const mobileEnv = join(root, 'apps', 'mobile', '.env');
  const mobileExample = join(root, 'apps', 'mobile', '.env.example');

  if (!existsSync(mobileEnv) && existsSync(mobileExample)) {
    if (DRY) log(`  [dry-run] cp .env.example -> apps/mobile/.env`);
    else {
      writeFileSync(mobileEnv, readFileSync(mobileExample, 'utf8'));
      log('  生成 apps/mobile/.env(从 .env.example),请填 EXPO_PUBLIC_SUPABASE_ANON_KEY');
    }
  }
  setEnvVar(mobileEnv, 'EXPO_PUBLIC_AGENT_URL', agentUrl);
  // 日常共用 dev 走免鉴权(见 ADR-0007):客户端跳过登录门,agent 端 DEV_NO_AUTH=1。
  setEnvVar(mobileEnv, 'EXPO_PUBLIC_DEV_NO_AUTH', '1');

  // 确保 agent 的 env-file 存在(supabase functions serve 读它);只在缺失时建模板,不覆盖已填的。
  const fnEnv = join(root, 'supabase', '.env');
  if (!existsSync(fnEnv)) {
    const tmpl = [
      '# agent edge function 的本地 secret(supabase functions serve --env-file 读取)。',
      '# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由本地 edge runtime 自动注入,勿在此设。',
      '# 模型 key 只在服务端;按需填 OpenRouter 或 Anthropic。',
      'MODEL_PROVIDER=openrouter',
      'OPENROUTER_API_KEY=',
      'OPENROUTER_MODEL=anthropic/claude-sonnet-4.5',
      '# 日常共用 dev 免鉴权(见 ADR-0007):本地注入的 SUPABASE_URL 与 token 的 iss 不一致,',
      '# 且 SUPABASE_JWT_ISS 是 SUPABASE_ 前缀进不了 env-file,故统一用 DEV_NO_AUTH 跳过。',
      'DEV_NO_AUTH=1',
      '',
    ].join('\n');
    if (DRY) log(`  [dry-run] write supabase/.env (模板)`);
    else {
      writeFileSync(fnEnv, tmpl);
      log('  生成 supabase/.env(模板),请填 OPENROUTER_API_KEY(或改用 ANTHROPIC_API_KEY)');
    }
  }
  log(`  EXPO_PUBLIC_AGENT_URL = ${agentUrl}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 共用 Supabase 栈在运行吗?不在则 supabase start;起失败直接 fail。
// `supabase status` 是只读探测,故 mutate:false(--dry-run 下也真跑);真正起栈才受 dry-run 约束。
function ensureStack(root) {
  const status = run('supabase', ['status'], { mutate: false, capture: true, cwd: root });
  if (status.code !== 0) {
    log('  栈未起,supabase start(共用栈,多 worktree 共用,注意别冲掉别人的数据)');
    const started = run('supabase', ['start'], { cwd: root });
    if (started.code !== 0) fail('supabase start 失败');
  } else {
    log('  栈已在运行');
  }
}

// agent edge function 是否已在 serve:探 /health(本地 supabase start 不自动 serve 函数,
// 必须另跑 supabase functions serve,故这是「serve 进程在不在」的可靠信号)。
async function agentHealthy(apiPort) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${apiPort}/functions/v1/agent/health`, { signal: ac.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// 确保 agent serve 在跑:已在(/health 正常)则跳过;否则 detached 后台拉起一个
// `supabase functions serve`(日志 / PID 落 tmp),再轮询 /health 几秒。轮询超时不阻断——
// 首次要编译 npm 依赖图较慢,serve 仍在后台继续,调用方(dev:ios)可照常起 Metro。
async function ensureAgentServe(root) {
  const apiPort = canonicalApiPort(root);
  if (await agentHealthy(apiPort)) {
    log('  agent edge function 已在 serve(/health 正常),跳过');
    return;
  }
  const token = worktreeHash(root);
  const logPath = join(tmpdir(), `incipel-agent-serve-${token}.log`);
  const pidPath = join(tmpdir(), `incipel-agent-serve-${token}.pid`);
  const serveArgs = ['functions', 'serve', 'agent', '--env-file', 'supabase/.env', '--no-verify-jwt'];
  if (DRY) {
    log(`  [dry-run] detached: supabase ${serveArgs.join(' ')}`);
    log(`  [dry-run] 日志 ${logPath} / pid ${pidPath}`);
    return;
  }
  // detached + unref + stdio 重定向到日志文件:Node 退出后该 serve 仍继续跑。
  const fd = openSync(logPath, 'a');
  const child = spawn('supabase', serveArgs, { cwd: root, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  if (child.pid) writeFileSync(pidPath, `${child.pid}\n`);
  log(`  已后台启动 agent serve(pid ${child.pid ?? '?'});日志 ${logPath}`);
  log(`  停止它:kill \$(cat ${pidPath})  (停整个栈:supabase stop)`);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await agentHealthy(apiPort)) {
      log('  agent 已就绪(/health 正常)');
      return;
    }
  }
  log('  agent 仍在后台编译启动(首次较慢),稍候即可;有问题看上面的日志。');
}

// ── dev:起共用栈(若未起)+ env sync + 前台 serve agent(带热重载日志)──────────
function dev(root) {
  log('▸ 同步 env');
  envSync(root);
  log('▸ 检查共用 Supabase 栈');
  ensureStack(root);
  log('▸ serve agent(前台,免网关 JWT,鉴权由 app 内 authenticate / DEV_NO_AUTH 决定)');
  run('supabase', ['functions', 'serve', 'agent', '--env-file', 'supabase/.env', '--no-verify-jwt'], {
    cwd: root,
  });
}

// ── up:确保「共用栈 + agent serve」就绪(serve 走后台,不阻塞)──────────────────
// 供 dev:ios / dev:android 在起 Metro 前调用,使一条 `pnpm dev:ios` 就把后端也带起来。
async function up(root) {
  log('▸ 同步 env');
  envSync(root);
  log('▸ 确保共用 Supabase 栈在运行');
  ensureStack(root);
  log('▸ 确保 agent edge function 在 serve');
  await ensureAgentServe(root);
}

// ── E2E 隔离栈 ────────────────────────────────────────────────────────────────
// canonical 5452x 端口段整体偏移一个 delta(≥100,且按 worktree 错开),得到本 worktree 专属端口段。
const PORT_KEYS = [
  ['api', 'port'],
  ['db', 'port'],
  ['db', 'shadow_port'],
  ['db.pooler', 'port'],
  ['studio', 'port'],
  ['inbucket', 'port'],
  ['edge_runtime', 'inspector_port'],
  ['analytics', 'port'],
];
function e2eWorkdir(root) {
  return join(root, '.worktree-supabase');
}
// 据 canonical config + worktree hash 生成隔离栈的 { projectId, delta, apiPort, configText }。
function planIsolatedStack(root) {
  const canonical = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  const hash = worktreeHash(root);
  // delta 落在 [100, 900],按 worktree 错开;步长 20 给一套栈留足相邻端口。
  const delta = 100 + (parseInt(hash.slice(0, 4), 16) % 40) * 20;
  const projectId = `incipel-e2e-${hash}`;

  let text = canonical;
  // project_id 行精确替换(避免动到注释里的 incipel/Incipel)。
  text = text.replace(/^project_id\s*=\s*".*?"/m, `project_id = "${projectId}"`);
  // 每个已知端口:原值 + delta。逐 section 定位,只替换该 section 下那一个 key 的数字。
  const ports = {};
  for (const [section, key] of PORT_KEYS) {
    const cur = tomlInt(canonical, section, key);
    if (cur == null) continue;
    const next = cur + delta;
    ports[`${section}.${key}`] = next;
    // 在该 section 块内替换 `key = <cur>`(数字唯一,直接整值替换即可)。
    text = text.replace(new RegExp(`(^|\\n)(\\s*${key}\\s*=\\s*)${cur}(\\b)`), `$1$2${next}$3`);
  }
  const apiPort = (tomlInt(canonical, 'api', 'port') ?? 54521) + delta;
  return { projectId, delta, apiPort, configText: text };
}
function e2eUp(root) {
  const plan = planIsolatedStack(root);
  const workdir = e2eWorkdir(root);
  const sb = join(workdir, 'supabase');
  log(`▸ 生成隔离栈 workdir: ${workdir}`);
  log(`  project_id=${plan.projectId}  端口偏移=+${plan.delta}  API=http://127.0.0.1:${plan.apiPort}`);

  if (DRY) {
    log(`  [dry-run] mkdir -p ${sb}`);
    log(`  [dry-run] write ${join(sb, 'config.toml')}  (project_id + 端口已偏移)`);
    log(`  [dry-run] symlink migrations / functions / seed(若有) -> ${sb}`);
  } else {
    mkdirSync(sb, { recursive: true });
    writeFileSync(join(sb, 'config.toml'), plan.configText);
    for (const name of ['migrations', 'functions', 'seed']) {
      const src = join(root, 'supabase', name);
      const dst = join(sb, name);
      if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst, 'dir');
    }
    // workdir 不该入库:写一份 .gitignore 兜底(根 .gitignore 也已忽略)。
    writeFileSync(join(workdir, '.gitignore'), '*\n');
  }

  log('▸ supabase start --workdir(隔离栈)');
  const started = run('supabase', ['start', '--workdir', workdir], { cwd: root });
  if (started.code !== 0 && !DRY) fail('隔离栈 supabase start 失败');

  const agentUrl = `http://127.0.0.1:${plan.apiPort}/functions/v1/agent`;
  log('');
  log('隔离栈已起。E2E 把客户端指向这套栈:');
  log(`  EXPO_PUBLIC_SUPABASE_URL = http://127.0.0.1:${plan.apiPort}`);
  log(`  EXPO_PUBLIC_AGENT_URL    = ${agentUrl}`);
  log(`  anon key / service key:supabase status --workdir ${workdir}`);
  log(`  serve agent(fake provider 等):supabase functions serve agent --workdir ${workdir} --env-file supabase/.env --no-verify-jwt`);
}
function e2eDown(root) {
  const workdir = e2eWorkdir(root);
  log(`▸ supabase stop --workdir ${workdir}`);
  run('supabase', ['stop', '--workdir', workdir], { cwd: root });
  log(`▸ 清理 ${workdir}`);
  if (DRY) log(`  [dry-run] rm -rf ${workdir}`);
  else if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
}

// ── 入口 ──────────────────────────────────────────────────────────────────────
function help() {
  // 打印文件顶部的注释头(到第一行非注释为止)作为用法说明。
  const header = [];
  for (const line of readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1)) {
    if (!line.startsWith('//')) break;
    header.push(line.replace(/^\/\/ ?/, ''));
  }
  log(header.join('\n'));
}

const root = cmd && cmd !== 'help' ? repoRoot() : null;
switch (cmd) {
  case 'dev':
    dev(root);
    break;
  case 'up':
    await up(root);
    break;
  case 'env':
    if (sub && sub !== 'sync') fail(`未知子命令: env ${sub}(只支持 env sync)`);
    log('▸ env sync');
    envSync(root);
    break;
  case 'e2e':
    if (sub === 'up') e2eUp(root);
    else if (sub === 'down') e2eDown(root);
    else fail('用法: e2e up | e2e down');
    break;
  case 'help':
  case undefined:
    help();
    break;
  default:
    fail(`未知命令: ${cmd}(可用: dev | up | env sync | e2e up|down | help)`);
}
