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
//   env [sync]       起共用栈(若未起)+ 同步 env:写 apps/mobile/.env 的 EXPO_PUBLIC_*、
//                    确保 supabase/.env 有本地 JWT 校验配置
//   e2e up           生成隔离 workdir + supabase start --workdir,打印该栈的 URL
//   e2e down         supabase stop --workdir + 清理 workdir
//   help

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
function isSensitiveEnvKey(key) {
  if (key.startsWith('EXPO_PUBLIC_')) return false;
  return key.includes('SECRET') || key.includes('TOKEN') || key.endsWith('_KEY');
}
// 替换/追加 .env 文件里的一行(整行前缀匹配);--dry-run 下只打印。
function setEnvVar(file, key, val) {
  const displayVal = isSensitiveEnvKey(key) ? '<redacted>' : val;
  const beforeText = existsSync(file) ? readFileSync(file, 'utf8') : '';
  let lines = beforeText ? beforeText.split('\n') : [];
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
  const nextText = lines.join('\n');
  const changed = nextText !== beforeText;
  if (DRY) {
    log(`  [dry-run] set ${key}=${displayVal}  (${file})`);
    return changed;
  }
  if (changed) writeFileSync(file, nextText);
  log(`  set ${key}=${displayVal}  (${file})`);
  return changed;
}
function getEnvVar(file, key) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m?.[1];
}
function unsetEnvVar(file, key) {
  if (!existsSync(file)) return false;
  const before = readFileSync(file, 'utf8').split('\n');
  const after = before.filter((line) => !line.startsWith(`${key}=`));
  const changed = after.length !== before.length;
  if (DRY) {
    log(`  [dry-run] unset ${key}  (${file})`);
    return changed;
  }
  if (changed) {
    writeFileSync(file, after.join('\n'));
    log(`  unset ${key}  (${file})`);
  }
  return changed;
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
function canonicalProjectId(root) {
  const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  const m = toml.match(/^project_id\s*=\s*"([^"]+)"/m);
  return m?.[1] ?? 'incipel';
}

function parseStatusJson(out) {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(out.slice(start, end + 1));
  } catch {
    return null;
  }
}

function statusVars(root) {
  const res = run('supabase', ['status', '-o', 'json'], { mutate: false, capture: true, cwd: root });
  if (res.code !== 0) return null;
  return parseStatusJson(res.stdout);
}

function worktreeRoots(root) {
  const res = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (res.status !== 0) return [];
  return res.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function primaryWorktreeRoot(root) {
  const roots = worktreeRoots(root);
  const primary = roots.find(
    (candidate) =>
      candidate !== root && !candidate.includes('/.claude/worktrees/') && !candidate.includes('/.codex/worktrees/')
  );
  if (primary) return primary;
  const marker = '/.claude/worktrees/';
  const idx = root.indexOf(marker);
  return idx >= 0 ? root.slice(0, idx) : null;
}

function setEnvVarFromFileIfPresent(dst, src, key) {
  const val = getEnvVar(src, key);
  if (!val) return false;
  return setEnvVar(dst, key, val);
}

function providerKey(provider) {
  if (provider === 'openrouter') return 'OPENROUTER_API_KEY';
  if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
  return null;
}

function copyFnEnvFromPrimaryForNewWorktree(root, fnEnv) {
  if (existsSync(fnEnv)) return { copied: false, available: false };
  const primaryRoot = primaryWorktreeRoot(root);
  const primaryEnv = primaryRoot ? join(primaryRoot, 'supabase', '.env') : null;
  if (!primaryEnv || !existsSync(primaryEnv)) return { copied: false, available: false };

  if (DRY) {
    log(`  [dry-run] cp ${primaryEnv} -> ${fnEnv}`);
    return { copied: false, available: true, changed: true };
  }
  writeFileSync(fnEnv, readFileSync(primaryEnv, 'utf8'));
  log('  从主工作区复制 supabase/.env');
  return { copied: true, available: true, changed: true };
}

function syncModelEnvFromPrimary(root, fnEnv) {
  const primaryRoot = primaryWorktreeRoot(root);
  const primaryEnv = primaryRoot ? join(primaryRoot, 'supabase', '.env') : null;
  const currentProvider = getEnvVar(fnEnv, 'MODEL_PROVIDER') || 'anthropic';
  const currentKey = providerKey(currentProvider);
  if (!primaryEnv || !existsSync(primaryEnv) || (currentKey && getEnvVar(fnEnv, currentKey))) return { copied: false };

  const primaryProvider = getEnvVar(primaryEnv, 'MODEL_PROVIDER') || currentProvider;
  const key = providerKey(primaryProvider);
  if (!key || !getEnvVar(primaryEnv, key)) {
    if (currentKey) log(`  注意:${currentKey} 为空,/logline 与 /run 的模型调用会失败;请填写 ${fnEnv}`);
    return { copied: false };
  }

  log(`  当前 worktree 缺少模型密钥;从主工作区补充模型配置`);
  let changed = false;
  changed = setEnvVarFromFileIfPresent(fnEnv, primaryEnv, 'MODEL_PROVIDER') || changed;
  changed = setEnvVarFromFileIfPresent(fnEnv, primaryEnv, key) || changed;
  if (primaryProvider === 'openrouter') changed = setEnvVarFromFileIfPresent(fnEnv, primaryEnv, 'OPENROUTER_MODEL') || changed;
  if (primaryProvider === 'anthropic') {
    changed = setEnvVarFromFileIfPresent(fnEnv, primaryEnv, 'TURN_MODEL') || changed;
    changed = setEnvVarFromFileIfPresent(fnEnv, primaryEnv, 'LOGLINE_MODEL') || changed;
  }
  return { changed };
}

// ── env sync:把 agent 路由相关的 env 写到位 ──────────────────────────────────
// agent 已不再是本地 Node 服务,客户端一律指向 edge function:`<api>/functions/v1/agent`。
function envSync(root) {
  const apiPort = canonicalApiPort(root);
  const status = statusVars(root);
  const apiUrl = status?.API_URL || `http://127.0.0.1:${apiPort}`;
  const agentUrl = `${apiUrl}/functions/v1/agent`;
  const mobileEnv = join(root, 'apps', 'mobile', '.env');
  const mobileExample = join(root, 'apps', 'mobile', '.env.example');

  if (!existsSync(mobileEnv) && existsSync(mobileExample)) {
    if (DRY) log(`  [dry-run] cp .env.example -> apps/mobile/.env`);
    else {
      writeFileSync(mobileEnv, readFileSync(mobileExample, 'utf8'));
      log('  生成 apps/mobile/.env(从 .env.example),请填 EXPO_PUBLIC_SUPABASE_ANON_KEY');
    }
  }
  setEnvVar(mobileEnv, 'EXPO_PUBLIC_SUPABASE_URL', apiUrl);
  if (status?.ANON_KEY) setEnvVar(mobileEnv, 'EXPO_PUBLIC_SUPABASE_ANON_KEY', status.ANON_KEY);
  setEnvVar(mobileEnv, 'EXPO_PUBLIC_AGENT_URL', agentUrl);
  // 日常 dev 走 Supabase anonymous auth:显示登录页,点「先随便逛逛」后取得真实 session。
  setEnvVar(mobileEnv, 'EXPO_PUBLIC_DEV_NO_AUTH', '');

  // 确保 agent 的 env-file 存在(supabase functions serve 读它):新 worktree 先从主工作区复制,
  // 复制不到才建模板;不把服务端模型密钥写进仓库。
  const fnEnv = join(root, 'supabase', '.env');
  const copiedFnEnv = copyFnEnvFromPrimaryForNewWorktree(root, fnEnv);
  let agentEnvChanged = copiedFnEnv.changed || false;
  if (!existsSync(fnEnv) && !copiedFnEnv.available) {
    const tmpl = [
      '# agent edge function 的本地 secret(supabase functions serve --env-file 读取)。',
      '# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由本地 edge runtime 自动注入,勿在此设。',
      '# 模型 key 只在服务端;按需填 OpenRouter 或 Anthropic。',
      'MODEL_PROVIDER=openrouter',
      'OPENROUTER_API_KEY=',
      'OPENROUTER_MODEL=anthropic/claude-sonnet-4.5',
      '# 本地 dev 默认走 Supabase anonymous auth,agent 照常校验 JWT 并使用 SupabaseStore。',
      '# INCIPEL_* 覆盖项只给本地 edge runtime 使用;客户端不会读取这个文件。',
      '',
    ].join('\n');
    if (DRY) log(`  [dry-run] write supabase/.env (模板)`);
    else {
      writeFileSync(fnEnv, tmpl);
      log('  生成 supabase/.env(模板),请填 OPENROUTER_API_KEY(或改用 ANTHROPIC_API_KEY)');
    }
    agentEnvChanged = true;
  }
  agentEnvChanged = unsetEnvVar(fnEnv, 'DEV_NO_AUTH') || agentEnvChanged;
  agentEnvChanged = unsetEnvVar(fnEnv, 'STORE') || agentEnvChanged;
  const modelEnv = existsSync(fnEnv) ? syncModelEnvFromPrimary(root, fnEnv) : { copied: false };
  agentEnvChanged = (modelEnv.changed || false) || agentEnvChanged;
  if (status?.JWT_SECRET) agentEnvChanged = setEnvVar(fnEnv, 'INCIPEL_SUPABASE_JWT_SECRET', status.JWT_SECRET) || agentEnvChanged;
  agentEnvChanged = setEnvVar(fnEnv, 'INCIPEL_SUPABASE_JWT_ISS', `${apiUrl}/auth/v1`) || agentEnvChanged;
  agentEnvChanged = setEnvVar(fnEnv, 'INCIPEL_SUPABASE_JWT_AUD', 'authenticated') || agentEnvChanged;
  log(`  EXPO_PUBLIC_SUPABASE_URL = ${apiUrl}`);
  log(`  EXPO_PUBLIC_AGENT_URL = ${agentUrl}`);
  return { agentEnvChanged };
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
function stopEdgeRuntime(root) {
  const container = `supabase_edge_runtime_${canonicalProjectId(root)}`;
  if (DRY) {
    run('docker', ['stop', container], { cwd: root });
    log(`  [dry-run] 将重启 ${container}`);
    return true;
  }
  const stopped = run('docker', ['stop', container], { capture: true, cwd: root });
  if (stopped.code !== 0) {
    log(`  注意:${container} 未停止;如果 agent 仍使用旧配置,请手动重启 supabase functions serve`);
    return false;
  }
  log(`  已停止 ${container},准备重新启动 agent`);
  return true;
}

async function ensureAgentServe(root, { restart = false } = {}) {
  const apiPort = canonicalApiPort(root);
  const healthy = await agentHealthy(apiPort);
  if (healthy && restart) {
    log('  agent env 已更新,重启 agent edge runtime');
    stopEdgeRuntime(root);
  } else if (healthy) {
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
  log('▸ 检查共用 Supabase 栈');
  ensureStack(root);
  log('▸ 同步 env');
  envSync(root);
  log('▸ serve agent(前台,网关不校验 JWT,鉴权由 app 内 authenticate 决定)');
  const r = run('supabase', ['functions', 'serve', 'agent', '--env-file', 'supabase/.env', '--no-verify-jwt'], {
    cwd: root,
  });
  // 传递 serve 的失败退出码(端口占用 / Deno 解析错 / Docker 问题),别把启动失败当成功退出。
  if (r.code !== 0) process.exit(r.code);
}

// ── up:确保「共用栈 + agent serve」就绪(serve 走后台,不阻塞)──────────────────
// 供 dev:ios / dev:android 在起 Metro 前调用,使一条 `pnpm dev:ios` 就把后端也带起来。
async function up(root) {
  log('▸ 确保共用 Supabase 栈在运行');
  ensureStack(root);
  log('▸ 同步 env');
  const synced = envSync(root);
  log('▸ 确保 agent edge function 在 serve');
  await ensureAgentServe(root, { restart: synced.agentEnvChanged });
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
function replaceDirSymlink(src, dst) {
  if (!existsSync(src)) return false;
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  symlinkSync(src, dst, 'dir');
  return true;
}
function copyDirFresh(src, dst) {
  if (!existsSync(src)) return false;
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  return true;
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
    log(`  [dry-run] symlink migrations / seed(若有) -> ${sb}`);
    log(`  [dry-run] copy supabase/functions -> ${join(sb, 'functions')}`);
    log(`  [dry-run] symlink packages -> ${join(workdir, 'packages')}`);
  } else {
    mkdirSync(sb, { recursive: true });
    writeFileSync(join(sb, 'config.toml'), plan.configText);
    for (const name of ['migrations', 'seed']) {
      const src = join(root, 'supabase', name);
      const dst = join(sb, name);
      replaceDirSymlink(src, dst);
    }
    copyDirFresh(join(root, 'supabase', 'functions'), join(sb, 'functions'));
    replaceDirSymlink(join(root, 'packages'), join(workdir, 'packages'));
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
    log('▸ 确保共用 Supabase 栈在运行');
    ensureStack(root);
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
