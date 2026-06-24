#!/usr/bin/env node
// incipel-dev —— 本仓库的开发命令行工具(见 docs/adr/0007)。
//
// agent 唯一运行时是 Mastra Node server;Supabase 仍负责本地数据库、Auth、Storage。
// 这个工具接手原来 dev-agent.sh / worktree-dev-env.sh 里 agent 相关的职责:写好各处环境变量、
// 起共用 Supabase 栈并启动固定端口的 dev agent server,以及为 E2E 生成「每 worktree 一套」的隔离栈
// (派生 project_id + 错开端口 + --workdir)。选 Node 而非 bash:生成 per-worktree config.toml 要改 TOML、做符号链接,
// bash 做这些易错。
//
// 零运行时依赖,纯 ESM。所有会改文件 / 起进程的动作都遵守 --dry-run:只打印不执行。
//
//   node tools/incipel-dev/cli.mjs <command> [--dry-run]
//
//   dev              起共用栈(若未起)+ 同步 env + 启动 agent server(前台,带热重载日志)
//   up               起共用栈(若未起)+ 同步 env + 后台启动 agent server(不阻塞;dev:ios/android 会调它)
//   env [sync]       起共用栈(若未起)+ 同步 env:写 apps/mobile/.env 的 EXPO_PUBLIC_*、
//                    确保 supabase/.env 有本地 JWT 校验配置
//   agent stop       停止当前 worktree 的后台 agent watcher / server(不停止数据库 / auth / storage)
//   e2e up           生成隔离 workdir + supabase start --workdir,打印该栈的 URL
//   e2e down         supabase stop --workdir + 清理 workdir
//   help

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
function run(bin, cmdArgs, { mutate = true, capture = false, cwd, env } = {}) {
  const shown = `${bin} ${cmdArgs.join(' ')}`;
  if (mutate && DRY) {
    log(`  [dry-run] ${shown}`);
    return { code: 0, stdout: '' };
  }
  const res = spawnSync(bin, cmdArgs, {
    cwd,
    env,
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
const AGENT_FUNCTION = 'agent';
const DEV_AGENT_PORT = 4111;
const E2E_AGENT_PORT_BASE = 6111;

// 本 worktree 的稳定短 hash(派生 project_id 与 E2E 端口偏移用)。
function worktreeHash(root) {
  return createHash('sha1').update(root).digest('hex').slice(0, 8);
}
function agentPort() {
  return DEV_AGENT_PORT;
}
function e2eAgentPort(root) {
  return E2E_AGENT_PORT_BASE + (parseInt(worktreeHash(root).slice(0, 4), 16) % 2000);
}
function sha1Text(text) {
  return createHash('sha1').update(text).digest('hex');
}

function agentPaths(root) {
  const token = worktreeHash(root);
  return {
    serveLog: join(tmpdir(), `incipel-agent-serve-${token}.log`),
    servePid: join(tmpdir(), `incipel-agent-serve-${token}.pid`),
    serveMeta: join(tmpdir(), `incipel-agent-serve-${token}.json`),
    serveEnvHash: join(tmpdir(), `incipel-agent-serve-${token}.env.sha1`),
    watcherLog: join(tmpdir(), `incipel-agent-watcher-${token}.log`),
    watcherMeta: join(tmpdir(), `incipel-agent-watcher-${token}.json`),
  };
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function collectFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function agentSourceFiles(root) {
  const files = [
    join(root, 'packages', 'agent', 'model.config.json'),
  ];
  collectFiles(join(root, 'packages', 'agent', 'src'), (file) => file.endsWith('.ts'), files);
  collectFiles(join(root, 'packages', 'shared', 'src'), (file) => file.endsWith('.ts'), files);
  return files.filter(existsSync).map((file) => relative(root, file)).sort();
}

function hashFiles(root, files) {
  const hash = createHash('sha1');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function agentSnapshot(root) {
  const sourceFiles = agentSourceFiles(root);
  const fnEnv = join(root, 'supabase', '.env');
  const envHash = existsSync(fnEnv) ? sha1Text(readFileSync(fnEnv, 'utf8')) : '';
  return {
    sourceFiles,
    sourceHash: hashFiles(root, sourceFiles),
    watchedPathsHash: sha1Text(sourceFiles.join('\n')),
    envHash,
  };
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
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
function agentProcessEnv(root) {
  return { ...process.env, ...readEnvFile(join(root, 'supabase', '.env')) };
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
function tomlString(toml, section, key) {
  const lines = toml.split('\n');
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) inSection = line === `[${section}]`;
    else if (inSection) {
      const m = line.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`));
      if (m) return m[1];
    }
  }
  return null;
}

// 共用栈(canonical config.toml)的 API 端口:日常 dev 的 edge URL 用它。
function canonicalApiPort(root) {
  const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  return tomlInt(toml, 'api', 'port') ?? 54521;
}
function googleWebClientId(root) {
  const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  const clientId = tomlString(toml, 'auth.external.google', 'client_id');
  return clientId?.split(',').map((id) => id.trim()).find(Boolean) ?? null;
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
function primaryEnvFile(root, ...segments) {
  const primaryRoot = primaryWorktreeRoot(root);
  const file = primaryRoot ? join(primaryRoot, ...segments) : null;
  return file && existsSync(file) ? file : null;
}

function syncMobileGoogleEnvFromPrimary(root, mobileEnv) {
  const primaryMobileEnv = primaryEnvFile(root, 'apps', 'mobile', '.env');
  if (!primaryMobileEnv) return { changed: false };

  let changed = false;
  changed = setEnvVarFromFileIfPresent(mobileEnv, primaryMobileEnv, 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID') || changed;
  return { changed };
}

function syncGoogleProviderSecretFromPrimary(root, fnEnv) {
  const primaryFnEnv = primaryEnvFile(root, 'supabase', '.env');
  if (!primaryFnEnv) return { changed: false };

  const changed = setEnvVarFromFileIfPresent(
    fnEnv,
    primaryFnEnv,
    'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET',
  );
  return { changed };
}

function syncModelProviderFromConfiguredKey(fnEnv) {
  if (getEnvVar(fnEnv, 'MODEL_PROVIDER')) return { changed: false };

  const hasOpenRouter = Boolean(getEnvVar(fnEnv, 'OPENROUTER_API_KEY'));
  if (hasOpenRouter) return { changed: setEnvVar(fnEnv, 'MODEL_PROVIDER', 'openrouter') };
  return { changed: false };
}

function providerKey(provider) {
  if (provider === 'openrouter') return 'OPENROUTER_API_KEY';
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
  const currentProvider = getEnvVar(fnEnv, 'MODEL_PROVIDER') || 'openrouter';
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
  return { changed };
}

// ── env sync:把 agent 路由相关的 env 写到位 ──────────────────────────────────
// 客户端指向当前 worktree 的 Mastra Node agent server;Supabase URL 继续指向本地共用栈。
function envSync(root) {
  const apiPort = canonicalApiPort(root);
  const status = statusVars(root);
  const apiUrl = status?.API_URL || `http://127.0.0.1:${apiPort}`;
  const localAgentPort = agentPort(root);
  const agentUrl = `http://127.0.0.1:${localAgentPort}`;
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
  const googleClientId = googleWebClientId(root);
  if (googleClientId) setEnvVar(mobileEnv, 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', googleClientId);
  syncMobileGoogleEnvFromPrimary(root, mobileEnv);
  // 日常 dev 走 Supabase anonymous auth:显示登录页,点「先随便逛逛」后取得真实 session。
  setEnvVar(mobileEnv, 'EXPO_PUBLIC_DEV_NO_AUTH', '');

  // 确保 agent server 的 env-file 存在:新 worktree 先从主工作区复制,
  // 复制不到才建模板;不把服务端模型密钥写进仓库。
  const fnEnv = join(root, 'supabase', '.env');
  const copiedFnEnv = copyFnEnvFromPrimaryForNewWorktree(root, fnEnv);
  let agentEnvChanged = copiedFnEnv.changed || false;
  if (!existsSync(fnEnv) && !copiedFnEnv.available) {
    const tmpl = [
      '# agent server 的本地环境变量(tools/incipel-dev 会读取并传给 @incipel/agent)。',
      '# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 tools/incipel-dev env sync 写入。',
      '# 模型 key 只在服务端;填 OpenRouter API key。',
      'MODEL_PROVIDER=openrouter',
      'OPENROUTER_API_KEY=',
      '# 模型 id / temperature / reasoning 配置在 packages/agent/model.config.json。',
      '# 本地 dev 默认走 Supabase anonymous auth,agent 照常校验 JWT 并使用 SupabaseStore。',
      '# INCIPEL_* 覆盖项只给本地 agent server 使用;客户端不会读取这个文件。',
      '',
    ].join('\n');
    if (DRY) log(`  [dry-run] write supabase/.env (模板)`);
    else {
      writeFileSync(fnEnv, tmpl);
      log('  生成 supabase/.env(模板),请填 OPENROUTER_API_KEY');
    }
    agentEnvChanged = true;
  }
  // dev:* / env:sync 强制 Supabase backend + anonymous auth(见 ADR-0009):始终从 supabase/.env
  // 移除 DEV_NO_AUTH / STORE,避免把 memory / 免鉴权带进日常开发。要 memory-only / 免鉴权调试,
  // 不要走 dev 脚本——直接用自备 env 启动 agent server(unsetEnvVar 会打印移除日志)。
  agentEnvChanged = unsetEnvVar(fnEnv, 'DEV_NO_AUTH') || agentEnvChanged;
  agentEnvChanged = unsetEnvVar(fnEnv, 'STORE') || agentEnvChanged;
  agentEnvChanged = setEnvVar(fnEnv, 'SUPABASE_URL', apiUrl) || agentEnvChanged;
  if (status?.SERVICE_ROLE_KEY) {
    agentEnvChanged = setEnvVar(fnEnv, 'SUPABASE_SERVICE_ROLE_KEY', status.SERVICE_ROLE_KEY) || agentEnvChanged;
  }
  agentEnvChanged = setEnvVar(fnEnv, 'AGENT_PORT', String(localAgentPort)) || agentEnvChanged;
  const modelEnv = existsSync(fnEnv) ? syncModelEnvFromPrimary(root, fnEnv) : { copied: false };
  agentEnvChanged = (modelEnv.changed || false) || agentEnvChanged;
  const modelProvider = existsSync(fnEnv) ? syncModelProviderFromConfiguredKey(fnEnv) : { changed: false };
  agentEnvChanged = (modelProvider.changed || false) || agentEnvChanged;
  const googleProviderSecret = existsSync(fnEnv) ? syncGoogleProviderSecretFromPrimary(root, fnEnv) : { changed: false };
  agentEnvChanged = (googleProviderSecret.changed || false) || agentEnvChanged;
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

// agent server 是否已在运行:探当前 worktree 的 /health。
async function agentHealthy(root) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${agentPort(root)}/health`, { signal: ac.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// 确保 agent server 在跑:已在(/health 正常)则跳过;否则 detached 后台拉起一个
// `pnpm --filter @incipel/agent dev`(日志 / PID 写入 tmp),再轮询 /health 几秒。
// 首次要编译 npm 依赖图较慢,server 仍在后台继续,调用方(dev:ios)可照常起 Metro。

function processAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCommand(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const res = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const command = res.stdout.trim();
  return command || null;
}

function processCwd(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      // Fall through to lsof for platforms or environments without /proc cwd.
    }
  }
  const res = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const line = res.stdout.split('\n').find((item) => item.startsWith('n'));
  return line ? line.slice(1) : null;
}

function normalizePath(file) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

function processCwdMatches(pid, cwd) {
  if (!cwd) return true;
  const actual = processCwd(pid);
  return Boolean(actual && normalizePath(actual) === normalizePath(cwd));
}

function listenPidsOnPort(port) {
  if (!Number.isFinite(port) || port <= 0) return [];
  const res = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (res.status !== 0) return [];
  return [...new Set(
    res.stdout
      .split(/\s+/)
      .map((item) => Number(item))
      .filter((pid) => Number.isFinite(pid) && pid > 0),
  )];
}

function commandHasWords(command, words) {
  return words.every((word) => command.includes(word));
}

function commandLooksLikeAgentServe(command) {
  return (
    commandHasWords(command, ['pnpm', '@incipel/agent', 'dev']) ||
    commandHasWords(command, ['tsx', 'src/index.ts'])
  );
}

function commandLooksLikeAgentWatcher(command) {
  return commandHasWords(command, ['cli.mjs', 'agent', 'watch']);
}

function pidMatches(pid, matcher, cwd) {
  if (!processAlive(pid)) return false;
  const command = processCommand(pid);
  return Boolean(command && matcher(command) && processCwdMatches(pid, cwd));
}

async function stopPid(pid, label, { commandMatches, cwd, killGroup = false } = {}) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (DRY) {
    log(`  [dry-run] kill ${pid} (${label})`);
    return true;
  }
  if (commandMatches) {
    const command = processCommand(pid);
    if (!command || !commandMatches(command)) {
      log(`  注意:${label} metadata 指向的 pid ${pid} 不是预期进程,跳过停止`);
      return false;
    }
  }
  if (!processCwdMatches(pid, cwd)) {
    log(`  注意:${label} metadata 指向的 pid ${pid} 不属于当前 worktree,跳过停止`);
    return false;
  }
  const termTargets = killGroup && process.platform !== 'win32' ? [-pid, pid] : [pid];
  let signaled = false;
  try {
    for (const target of termTargets) {
      try {
        process.kill(target, 'SIGTERM');
        signaled = true;
        break;
      } catch (err) {
        if (err?.code !== 'ESRCH') throw err;
      }
    }
    if (!signaled) {
      log(`  ${label} 进程已不存在(pid ${pid})`);
      return false;
    }
  } catch (err) {
    log(`  注意:${label} 进程(pid ${pid}) 未停止:${err.message}`);
    return false;
  }
  for (let i = 0; i < 15; i++) {
    await sleep(100);
    if (!processAlive(pid)) {
      log(`  已停止 ${label} 进程(pid ${pid})`);
      return true;
    }
  }
  const killTargets = killGroup && process.platform !== 'win32' ? [-pid, pid] : [pid];
  try {
    for (const target of killTargets) {
      try {
        process.kill(target, 'SIGKILL');
        break;
      } catch (err) {
        if (err?.code !== 'ESRCH') throw err;
      }
    }
    log(`  已强制停止 ${label} 进程(pid ${pid})`);
    return true;
  } catch (err) {
    if (err?.code === 'ESRCH') return true;
    log(`  注意:${label} 进程(pid ${pid}) 未强制停止:${err.message}`);
    return false;
  }
}

function isCurrentAgentMeta(meta, root) {
  return meta?.repoRoot === root && meta?.functionName === AGENT_FUNCTION;
}

function readPidFile(pidPath) {
  if (!existsSync(pidPath)) return null;
  const pid = Number(readFileSync(pidPath, 'utf8').trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

async function stopKnownAgentServe(paths, meta = null, cwd = null) {
  const candidates = [];
  const metaPid = Number(meta?.pid);
  if (Number.isFinite(metaPid) && metaPid > 0) candidates.push(metaPid);
  const filePid = readPidFile(paths.servePid);
  if (filePid && !candidates.includes(filePid)) candidates.push(filePid);

  let stopped = false;
  for (const pid of candidates) {
    stopped = (await stopPid(pid, 'agent serve', { commandMatches: commandLooksLikeAgentServe, cwd, killGroup: true })) || stopped;
  }

  for (const pid of listenPidsOnPort(agentPort(cwd ?? process.cwd()))) {
    if (candidates.includes(pid)) continue;
    stopped =
      (await stopPid(pid, 'agent serve listener', { commandMatches: commandLooksLikeAgentServe, cwd, killGroup: true })) ||
      stopped;
  }
  return stopped;
}

async function stopAgent(root) {
  const paths = agentPaths(root);
  const watcherMeta = readJson(paths.watcherMeta);
  const serveMeta = readJson(paths.serveMeta);
  let stoppedAny = false;
  let stoppedServe = false;

  if (isCurrentAgentMeta(watcherMeta, root)) {
    if (watcherMeta.logPath) log(`  agent watcher 日志:${watcherMeta.logPath}`);
    stoppedAny =
      (await stopPid(Number(watcherMeta.pid), 'agent watcher', { commandMatches: commandLooksLikeAgentWatcher, cwd: root })) ||
      stoppedAny;
    if (!DRY) rmSync(paths.watcherMeta, { force: true });
  }

  if (isCurrentAgentMeta(serveMeta, root)) {
    if (serveMeta.logPath) log(`  agent serve 日志:${serveMeta.logPath}`);
    stoppedServe = await stopKnownAgentServe(paths, serveMeta, root);
    stoppedAny = stoppedServe || stoppedAny;
    if (!DRY) {
      rmSync(paths.serveMeta, { force: true });
      rmSync(paths.servePid, { force: true });
      rmSync(paths.serveEnvHash, { force: true });
    }
  }

  if (!stoppedAny) log('  没有可安全停止的当前 worktree agent 进程');
}

async function ensureAgentServe(root, { restart = false } = {}) {
  const paths = agentPaths(root);
  const snapshot = agentSnapshot(root);
  const meta = readJson(paths.serveMeta);
  const prevEnvHash = existsSync(paths.serveEnvHash) ? readFileSync(paths.serveEnvHash, 'utf8').trim() : null;
  const envFileChanged = prevEnvHash !== snapshot.envHash;
  const healthy = await agentHealthy(root);
  if (healthy) {
    let reason = null;
    if (meta) {
      if (meta.repoRoot !== root || meta.functionName !== AGENT_FUNCTION) {
        reason = 'agent serve metadata does not match current worktree, restarting';
      } else if (restart || meta.sourceHash !== snapshot.sourceHash || meta.envHash !== snapshot.envHash) {
        reason = 'agent source/env changed, restarting agent server';
      } else if (!DRY && !pidMatches(Number(meta.pid), commandLooksLikeAgentServe, root)) {
        reason = 'agent serve metadata pid is stale, restarting agent server';
      }
    } else if (restart || envFileChanged) {
      reason = 'agent env-file 内容已变化,重启 agent server';
    } else {
      reason = 'agent serve metadata does not match current worktree, restarting';
    }

    if (reason) {
      log(`  ${reason}`);
      await stopKnownAgentServe(paths, isCurrentAgentMeta(meta, root) ? meta : null, root);
    } else {
      log('  agent server 已在运行(/health 正常),跳过');
      return;
    }
  }
  const serveArgs = ['--filter', '@incipel/agent', 'dev'];
  const serveCommand = `pnpm ${serveArgs.join(' ')}`;
  if (DRY) {
    log(`  [dry-run] detached: ${serveCommand}`);
    log(`  [dry-run] 日志 ${paths.serveLog} / pid ${paths.servePid} / metadata ${paths.serveMeta}`);
    return;
  }
  // detached + unref + stdio 重定向到日志文件:Node 退出后该 server 仍继续跑。
  const fd = openSync(paths.serveLog, 'a');
  const child = spawn('pnpm', serveArgs, {
    cwd: root,
    detached: true,
    env: agentProcessEnv(root),
    stdio: ['ignore', fd, fd],
  });
  // 监听早退:server 因 env / 端口错误立刻退出时,别让健康检查超时后还误报为仍在编译。
  // 父进程(本 CLI)存活期间 'exit' 照常触发。
  let serveExited = false;
  let serveExitCode = null;
  child.on('exit', (code) => {
    serveExited = true;
    serveExitCode = code;
  });
  child.unref();
  if (child.pid) writeFileSync(paths.servePid, `${child.pid}\n`);
  writeJson(paths.serveMeta, {
    repoRoot: root,
    functionName: AGENT_FUNCTION,
    pid: child.pid ?? null,
    command: serveCommand,
    logPath: paths.serveLog,
    sourceHash: snapshot.sourceHash,
    envHash: snapshot.envHash,
    watchedPathsHash: snapshot.watchedPathsHash,
    sourceFiles: snapshot.sourceFiles,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  });
  log(`  已后台启动 agent server(pid ${child.pid ?? '?'});日志 ${paths.serveLog}`);
  log(`  停止它:kill \$(cat ${paths.servePid})  (停整个栈:supabase stop)`);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (serveExited) {
      fail(`agent server 启动即退出(exit ${serveExitCode ?? '?'});多半是 env / 端口问题;看日志:${paths.serveLog}`);
    }
    if (await agentHealthy(root)) {
      writeFileSync(paths.serveEnvHash, `${snapshot.envHash}\n`);
      writeJson(paths.serveMeta, {
        repoRoot: root,
        functionName: AGENT_FUNCTION,
        pid: child.pid ?? null,
        command: serveCommand,
        logPath: paths.serveLog,
        sourceHash: snapshot.sourceHash,
        envHash: snapshot.envHash,
        watchedPathsHash: snapshot.watchedPathsHash,
        sourceFiles: snapshot.sourceFiles,
        status: 'ready',
        updatedAt: new Date().toISOString(),
      });
      log('  agent 已就绪(/health 正常)');
      return;
    }
  }
  if (serveExited) {
    fail(`agent server 启动即退出(exit ${serveExitCode ?? '?'});看日志:${paths.serveLog}`);
  }
  log('  agent server 仍在后台编译启动(首次较慢),稍候即可;有问题看上面的日志。');
}

async function ensureAgentWatcher(root) {
  const paths = agentPaths(root);
  const snapshot = agentSnapshot(root);
  const meta = readJson(paths.watcherMeta);
  if (
    meta?.repoRoot === root &&
    meta?.functionName === AGENT_FUNCTION &&
    meta?.watchedPathsHash === snapshot.watchedPathsHash &&
    (DRY || pidMatches(Number(meta.pid), commandLooksLikeAgentWatcher, root))
  ) {
    log('  agent watcher 已在监控当前 worktree,跳过');
    return;
  }

  if (meta && (meta.repoRoot !== root || meta.functionName !== AGENT_FUNCTION)) {
    log('  agent watcher metadata does not match current worktree, restarting');
  } else if (meta && meta.watchedPathsHash !== snapshot.watchedPathsHash) {
    log('  agent watcher watched paths changed, restarting');
  } else if (meta && !processAlive(Number(meta.pid))) {
    log('  agent watcher 进程不在,重新启动');
  } else {
    log('  agent watcher metadata missing, starting');
  }

  if (!DRY && isCurrentAgentMeta(meta, root)) {
    await stopPid(Number(meta.pid), 'agent watcher', { commandMatches: commandLooksLikeAgentWatcher, cwd: root });
  }

  const cliPath = fileURLToPath(import.meta.url);
  const watchArgs = [cliPath, 'agent', 'watch'];
  if (DRY) {
    log(`  [dry-run] detached: node tools/incipel-dev/cli.mjs agent watch`);
    log(`  [dry-run] watcher 日志 ${paths.watcherLog} / metadata ${paths.watcherMeta}`);
    return;
  }

  const fd = openSync(paths.watcherLog, 'a');
  const child = spawn(process.execPath, watchArgs, { cwd: root, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  writeJson(paths.watcherMeta, {
    repoRoot: root,
    functionName: AGENT_FUNCTION,
    pid: child.pid ?? null,
    command: `node tools/incipel-dev/cli.mjs agent watch`,
    logPath: paths.watcherLog,
    watchedPathsHash: snapshot.watchedPathsHash,
    sourceFiles: snapshot.sourceFiles,
    status: 'starting',
    updatedAt: new Date().toISOString(),
  });
  log(`  已后台启动 agent watcher(pid ${child.pid ?? '?'});日志 ${paths.watcherLog}`);
}

async function watchAgent(root) {
  const paths = agentPaths(root);
  let snapshot = agentSnapshot(root);
  writeJson(paths.watcherMeta, {
    repoRoot: root,
    functionName: AGENT_FUNCTION,
    pid: process.pid,
    command: 'node tools/incipel-dev/cli.mjs agent watch',
    logPath: paths.watcherLog,
    watchedPathsHash: snapshot.watchedPathsHash,
    sourceFiles: snapshot.sourceFiles,
    sourceHash: snapshot.sourceHash,
    envHash: snapshot.envHash,
    status: 'watching',
    updatedAt: new Date().toISOString(),
  });
  log('agent watcher started');
  for (;;) {
    await sleep(1000);
    const next = agentSnapshot(root);
    const changed =
      next.sourceHash !== snapshot.sourceHash ||
      next.envHash !== snapshot.envHash ||
      next.watchedPathsHash !== snapshot.watchedPathsHash;
    if (!changed) continue;

    await sleep(300);
    const stable = agentSnapshot(root);
    const stillChanged =
      stable.sourceHash !== snapshot.sourceHash ||
      stable.envHash !== snapshot.envHash ||
      stable.watchedPathsHash !== snapshot.watchedPathsHash;
    if (!stillChanged) continue;

    log('agent source/env changed; restarting serve');
    await ensureAgentServe(root, { restart: true });
    snapshot = stable;
    writeJson(paths.watcherMeta, {
      repoRoot: root,
      functionName: AGENT_FUNCTION,
      pid: process.pid,
      command: 'node tools/incipel-dev/cli.mjs agent watch',
      logPath: paths.watcherLog,
      watchedPathsHash: snapshot.watchedPathsHash,
      sourceFiles: snapshot.sourceFiles,
      sourceHash: snapshot.sourceHash,
      envHash: snapshot.envHash,
      status: 'watching',
      updatedAt: new Date().toISOString(),
    });
  }
}

// ── dev:起共用栈(若未起)+ env sync + 前台 agent server(带热重载日志)──────────
function dev(root) {
  log('▸ 检查共用 Supabase 栈');
  ensureStack(root);
  log('▸ 同步 env');
  envSync(root);
  log('▸ 启动 agent server(前台)');
  const r = run('pnpm', ['--filter', '@incipel/agent', 'dev'], {
    cwd: root,
    env: agentProcessEnv(root),
  });
  // 传递 server 的失败退出码(端口占用 / env 错误),别把启动失败当成功退出。
  if (r.code !== 0) process.exit(r.code);
}

// ── up:确保「共用栈 + agent server」就绪(server 走后台,不阻塞)──────────────────
// 供 dev:ios / dev:android 在起 Metro 前调用,使一条 `pnpm dev:ios` 就把后端也带起来。
async function up(root) {
  log('▸ 确保共用 Supabase 栈在运行');
  ensureStack(root);
  log('▸ 同步 env');
  const synced = envSync(root);
  log('▸ 确保 agent server 在运行');
  await ensureAgentServe(root, { restart: synced.agentEnvChanged });
  log('▸ 确保 agent watcher 在监控当前 worktree');
  await ensureAgentWatcher(root);
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
  // [studio] api_url = "http://127.0.0.1:54521" 指向 canonical 的 api 端口,不在 PORT_KEYS、上面的
  // 端口正则也匹配不到;单独改写到隔离栈的 api 端口,否则隔离栈的 Studio 会连去共用栈、看错数据(评审 #2)。
  text = text.replace(/(\bapi_url\s*=\s*"http:\/\/127\.0\.0\.1:)(\d+)(")/, `$1${apiPort}$3`);
  return { projectId, delta, apiPort, configText: text };
}
function isolatedAgentPort(root, plan) {
  return e2eAgentPort(root) + 2000 + plan.delta;
}
function replaceDirSymlink(src, dst) {
  if (!existsSync(src)) return false;
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  symlinkSync(src, dst, 'dir');
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
  } else {
    mkdirSync(sb, { recursive: true });
    writeFileSync(join(sb, 'config.toml'), plan.configText);
    for (const name of ['migrations', 'seed']) {
      const src = join(root, 'supabase', name);
      const dst = join(sb, name);
      replaceDirSymlink(src, dst);
    }
    // workdir 不该入库:再写一份 .gitignore 作为额外保护(根 .gitignore 也已忽略)。
    writeFileSync(join(workdir, '.gitignore'), '*\n');
  }

  log('▸ supabase start --workdir(隔离栈)');
  const started = run('supabase', ['start', '--workdir', workdir], { cwd: root });
  if (started.code !== 0 && !DRY) fail('隔离栈 supabase start 失败');

  const isoApi = `http://127.0.0.1:${plan.apiPort}`;
  const isoAgentPort = isolatedAgentPort(root, plan);
  const agentUrl = `http://127.0.0.1:${isoAgentPort}`;
  // 为隔离栈生成专属 agent env-file:用隔离栈自己的 API 端口(issuer)与 JWT secret。否则若复用共用栈的
  // supabase/.env,其 INCIPEL_SUPABASE_JWT_ISS 指向 54521,而隔离栈签出的 token issuer 是
  // 127.0.0.1:<apiPort>,authenticate() 优先用这个本地覆盖 → /run、/logline 全部 401(评审 B)。
  const isoEnvFile = join(workdir, 'agent.env');
  if (DRY) {
    log(`  [dry-run] write ${isoEnvFile}(隔离栈 Supabase URL/service key/issuer/secret + agent 端口)`);
  } else {
    const isoRes = run('supabase', ['status', '--workdir', workdir, '-o', 'json'], { mutate: false, capture: true, cwd: root });
    const isoStatus = isoRes.code === 0 ? parseStatusJson(isoRes.stdout) : null;
    const sharedFnEnv = join(root, 'supabase', '.env');
    const lines = ['# 隔离 E2E 栈的 agent env(由 tools/incipel-dev e2e up 生成,勿入库)'];
    for (const k of ['MODEL_PROVIDER', 'OPENROUTER_API_KEY']) {
      const v = existsSync(sharedFnEnv) ? getEnvVar(sharedFnEnv, k) : null;
      if (v) lines.push(`${k}=${v}`);
    }
    lines.push(`SUPABASE_URL=${isoApi}`);
    if (isoStatus?.SERVICE_ROLE_KEY) lines.push(`SUPABASE_SERVICE_ROLE_KEY=${isoStatus.SERVICE_ROLE_KEY}`);
    lines.push(`AGENT_PORT=${isoAgentPort}`);
    lines.push(`INCIPEL_SUPABASE_JWT_ISS=${isoApi}/auth/v1`);
    lines.push('INCIPEL_SUPABASE_JWT_AUD=authenticated');
    if (isoStatus?.JWT_SECRET) lines.push(`INCIPEL_SUPABASE_JWT_SECRET=${isoStatus.JWT_SECRET}`);
    lines.push('');
    writeFileSync(isoEnvFile, lines.join('\n'));
  }

  log('');
  log('隔离栈已起。E2E 把客户端指向这套栈:');
  log(`  EXPO_PUBLIC_SUPABASE_URL = ${isoApi}`);
  log(`  EXPO_PUBLIC_AGENT_URL    = ${agentUrl}`);
  log(`  anon key / service key:supabase status --workdir ${workdir}`);
  log(`  start agent:(set -a; . ${isoEnvFile}; set +a; pnpm --filter @incipel/agent start)`);
  log(`  (${isoEnvFile} 已写好隔离栈自己的 SUPABASE_URL 与 INCIPEL_SUPABASE_JWT_ISS=${isoApi}/auth/v1)`);
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
  case 'agent':
    if (sub === 'stop') await stopAgent(root);
    else if (sub === 'watch') await watchAgent(root);
    else fail('用法: agent stop | agent watch');
    break;
  case 'help':
  case undefined:
    help();
    break;
  default:
    fail(`未知命令: ${cmd}(可用: dev | up | env sync | agent stop | e2e up|down | help)`);
}
