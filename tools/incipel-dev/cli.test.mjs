import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');

// 测试用临时 dev agent 端口:按进程区分,避开真 dev 的固定 4111,使本套件可与正在跑的 dev 共存
// (也避免并行跑多个测试文件时互撞)。CLI 经 INCIPEL_DEV_AGENT_PORT 读取它(见 cli.mjs agentPort());
// 这里写进本进程 env,run() 起的子进程会继承。
const TEST_AGENT_PORT = 20000 + (process.pid % 40000);
process.env.INCIPEL_DEV_AGENT_PORT = String(TEST_AGENT_PORT);

function run(bin, args, cwd, options = {}) {
  return spawnSync(bin, args, {
    cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function envWithout(...keys) {
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  return env;
}

function mustRun(bin, args, cwd) {
  const res = run(bin, args, cwd);
  assert.equal(res.status, 0, `${bin} ${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

function normalizeRoot(root) {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

function agentPort() {
  return TEST_AGENT_PORT;
}

async function portAvailable(port) {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePortPair() {
  const start = 20000 + (process.pid % 20000);
  for (let offset = 0; offset < 1000; offset += 1) {
    const port = start + offset * 2;
    if ((await portAvailable(port)) && (await portAvailable(port + 1))) return port;
  }
  throw new Error('could not find two adjacent free ports');
}

function e2eAgentPort(root) {
  return 6111 + (parseInt(sha1(normalizeRoot(root)).slice(0, 4), 16) % 2000);
}

function metadataPaths(root) {
  const token = sha1(root).slice(0, 8);
  return {
    serveMeta: path.join(tmpdir(), `incipel-agent-serve-${token}.json`),
    servePid: path.join(tmpdir(), `incipel-agent-serve-${token}.pid`),
    watcherMeta: path.join(tmpdir(), `incipel-agent-watcher-${token}.json`),
  };
}

function cleanupMetadata(root) {
  const paths = metadataPaths(root);
  if (existsSync(paths.servePid)) {
    const pid = Number(readFileSync(paths.servePid, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may have already exited.
      }
    }
  }
  for (const file of [paths.serveMeta, paths.watcherMeta]) {
    if (!existsSync(file)) continue;
    try {
      const meta = JSON.parse(readFileSync(file, 'utf8'));
      const pid = Number(meta.pid);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Process may have already exited.
        }
      }
    } catch {
      // Ignore malformed test metadata.
    }
  }
  rmSync(paths.serveMeta, { force: true });
  rmSync(paths.servePid, { force: true });
  rmSync(paths.watcherMeta, { force: true });
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try {
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, { timeoutMs: 1000, intervalMs: 50 });
    return;
  } catch {
    child.kill('SIGKILL');
  }
}

function sourceFiles(root) {
  return [
    'packages/agent/model.config.json',
    'packages/agent/src/app.ts',
    'packages/agent/src/index.ts',
    'packages/shared/src/tools.ts',
  ];
}

function hashFiles(root, files) {
  const h = createHash('sha1');
  for (const file of files) {
    h.update(file);
    h.update('\0');
    h.update(readFileSync(path.join(root, file)));
    h.update('\0');
  }
  return h.digest('hex');
}

function matchingServeMetadata(root) {
  const files = sourceFiles(root);
  return {
    repoRoot: root,
    functionName: 'agent',
    pid: 12345,
    command: 'pnpm --filter @incipel/agent start',
    logPath: path.join(tmpdir(), `incipel-agent-serve-${sha1(root).slice(0, 8)}.log`),
    sourceHash: hashFiles(root, files),
    envHash: sha1(readFileSync(path.join(root, 'supabase', '.env'), 'utf8')),
    watchedPathsHash: sha1(files.join('\n')),
    sourceFiles: files,
    status: 'ready',
    updatedAt: '2026-06-23T00:00:00.000Z',
  };
}

function writeAgentFixture(root, port) {
  const aPort = agentPort(root);
  mkdirSync(path.join(root, 'apps', 'mobile'), { recursive: true });
  mkdirSync(path.join(root, 'supabase', 'functions', 'agent'), { recursive: true });
  mkdirSync(path.join(root, 'packages', 'agent', 'src'), { recursive: true });
  mkdirSync(path.join(root, 'packages', 'shared', 'src'), { recursive: true });
  mkdirSync(path.join(root, 'bin'), { recursive: true });

  writeFileSync(path.join(root, 'supabase', 'config.toml'), ['project_id = "incipel"', '', '[api]', `port = ${port}`, ''].join('\n'));
  writeFileSync(
    path.join(root, 'apps', 'mobile', '.env'),
    [
      `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}`,
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon',
      `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:${aPort}`,
      'EXPO_PUBLIC_DEV_NO_AUTH=',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'supabase', '.env'),
    [
      'MODEL_PROVIDER=openrouter',
      'OPENROUTER_API_KEY=sk-test',
      `SUPABASE_URL=http://127.0.0.1:${port}`,
      'SUPABASE_SERVICE_ROLE_KEY=service',
      `AGENT_PORT=${aPort}`,
      `INCIPEL_SUPABASE_JWT_ISS=http://127.0.0.1:${port}/auth/v1`,
      'INCIPEL_SUPABASE_JWT_AUD=authenticated',
      'INCIPEL_SUPABASE_JWT_SECRET=secret',
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(root, 'supabase', 'functions', 'agent', 'index.ts'), 'Deno.serve(() => new Response("ok"));\n');
  writeFileSync(path.join(root, 'supabase', 'functions', 'agent', 'deno.json'), '{"imports":{}}\n');
  writeFileSync(path.join(root, 'packages', 'agent', 'src', 'app.ts'), 'export const app = "agent";\n');
  writeFileSync(path.join(root, 'packages', 'agent', 'src', 'index.ts'), 'export const server = "agent";\n');
  writeFileSync(path.join(root, 'packages', 'agent', 'model.config.json'), '{"provider":"stub"}\n');
  writeFileSync(path.join(root, 'packages', 'shared', 'src', 'tools.ts'), 'export const tools = [];\n');
  writeFileSync(
    path.join(root, 'bin', 'supabase'),
    [
      '#!/bin/sh',
      'if [ "$1" = "status" ]; then',
      '  if [ "$2" = "-o" ] && [ "$3" = "json" ]; then',
      `    printf '%s\\n' '{"API_URL":"http://127.0.0.1:${port}","ANON_KEY":"anon","SERVICE_ROLE_KEY":"service","JWT_SECRET":"secret"}'`,
      '  else',
      '    printf "%s\\n" "supabase local development setup is running."',
      '  fi',
      '  exit 0',
      'fi',
      'printf "%s\\n" "unexpected supabase command: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

function writeFakeDocker(root) {
  writeFileSync(
    path.join(root, 'bin', 'docker'),
    ['#!/bin/sh', 'printf "%s\\n" "docker $*" >> "$INC_TEST_DOCKER_LOG"', 'exit 0', ''].join('\n'),
    { mode: 0o755 },
  );
}

function makeFakeAgentServe(root, port) {
  writeFileSync(
    path.join(root, 'bin', 'pnpm'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--filter" ] && [ "$2" = "@incipel/agent" ] && { [ "$3" = "dev" ] || [ "$3" = "start" ]; }; then',
      '  printf "%s\\n" "pnpm $*" >> "$INC_TEST_SERVE_LOG"',
      `  exec "${process.execPath}" -e 'setInterval(() => {}, 1000)' pnpm --filter @incipel/agent "$3"`,
      'fi',
      'printf "%s\\n" "unexpected pnpm command: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

function makeFakeAgentDevExit(root) {
  writeFileSync(
    path.join(root, 'bin', 'pnpm'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--filter" ] && [ "$2" = "@incipel/agent" ] && [ "$3" = "dev" ]; then',
      '  printf "%s\\n" "pnpm $*" >> "$INC_TEST_SERVE_LOG"',
      '  printf "%s\\n" "AGENT_PORT=$AGENT_PORT" >> "$INC_TEST_SERVE_LOG"',
      '  exit 0',
      'fi',
      'printf "%s\\n" "unexpected pnpm command: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

async function startHealthServer(port = 0) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      [
        'const http = require("node:http");',
        'const server = http.createServer((req, res) => {',
        '  if (req.url === "/health") {',
        '    res.writeHead(200, { "Content-Type": "application/json" });',
        '    res.end("{\\"ok\\":true}");',
        '    return;',
        '  }',
        '  res.writeHead(404);',
        '  res.end();',
        '});',
        `server.listen(${port}, "127.0.0.1", () => console.log(server.address().port));`,
      ].join('\n'),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const listeningPort = await new Promise((resolve, reject) => {
    child.stdout.once('data', (buf) => resolve(Number(String(buf).trim())));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`health server exited with ${code}`));
    });
  });
  return { child, port: listeningPort };
}

async function startAgentLikeHealthServer(root, port = agentPort(root)) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      [
        'const http = require("node:http");',
        'const server = http.createServer((req, res) => {',
        '  if (req.url === "/health") {',
        '    res.writeHead(200, { "Content-Type": "application/json" });',
        '    res.end("{\\"ok\\":true}");',
        '    return;',
        '  }',
        '  res.writeHead(404);',
        '  res.end();',
        '});',
        `server.listen(${port}, "127.0.0.1", () => console.log(server.address().port));`,
      ].join('\n'),
      'tsx',
      'src/index.ts',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const listeningPort = await new Promise((resolve, reject) => {
    child.stdout.once('data', (buf) => resolve(Number(String(buf).trim())));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`agent-like health server exited with ${code}`));
    });
  });
  return { child, port: listeningPort };
}

function hasLsof() {
  const res = spawnSync('lsof', ['-v'], { stdio: 'ignore' });
  return res.status === 0;
}

test('env sync copies Google env from the primary worktree when a child worktree already has env files', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  try {
    const primary = path.join(tmp, 'primary');
    const child = path.join(tmp, 'child');
    mkdirSync(path.join(primary, 'apps', 'mobile'), { recursive: true });
    mkdirSync(path.join(primary, 'supabase'), { recursive: true });

    writeFileSync(
      path.join(primary, 'supabase', 'config.toml'),
      [
        '[api]',
        'port = 54521',
        '',
        '[auth.external.google]',
        'enabled = true',
        'client_id = "web-client.apps.googleusercontent.com"',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(primary, 'apps', 'mobile', '.env.example'),
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\n',
    );
    writeFileSync(
      path.join(primary, 'apps', 'mobile', '.env'),
      [
        'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=web-client.apps.googleusercontent.com',
        'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=ios-client.apps.googleusercontent.com',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(primary, 'supabase', '.env'),
      [
        'MODEL_PROVIDER=openrouter',
        'OPENROUTER_API_KEY=sk-test',
        'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=google-secret',
        '',
      ].join('\n'),
    );

    mustRun('git', ['init'], primary);
    mustRun('git', ['add', 'apps/mobile/.env.example', 'supabase/config.toml'], primary);
    mustRun(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
      primary,
    );
    mustRun('git', ['worktree', 'add', '-b', 'child', child], primary);

    writeFileSync(
      path.join(child, 'apps', 'mobile', '.env'),
      [
        'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521',
        `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:${agentPort(child)}`,
        '',
      ].join('\n'),
    );
    writeFileSync(path.join(child, 'supabase', '.env'), 'MODEL_PROVIDER=openrouter\n');

    const res = run('node', [cli, 'env', 'sync', '--dry-run'], child);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=web-client\.apps\.googleusercontent\.com/);
    assert.match(res.stdout, /set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=ios-client\.apps\.googleusercontent\.com/);
    assert.match(res.stdout, /set SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<redacted>/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('env sync selects openrouter when only an OpenRouter key is configured', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  try {
    mkdirSync(path.join(tmp, 'apps', 'mobile'), { recursive: true });
    mkdirSync(path.join(tmp, 'supabase'), { recursive: true });

    writeFileSync(
      path.join(tmp, 'supabase', 'config.toml'),
      ['[api]', 'port = 54521', '', '[auth.external.google]', 'enabled = true', 'client_id = "web-client"', ''].join('\n'),
    );
    writeFileSync(path.join(tmp, 'apps', 'mobile', '.env.example'), 'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\n');
    writeFileSync(path.join(tmp, 'apps', 'mobile', '.env'), 'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\n');
    writeFileSync(path.join(tmp, 'supabase', '.env'), 'OPENROUTER_API_KEY=sk-test\n');

    mustRun('git', ['init'], tmp);
    mustRun('git', ['add', 'apps/mobile/.env.example', 'supabase/config.toml'], tmp);
    mustRun('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], tmp);

    const res = run('node', [cli, 'env', 'sync', '--dry-run'], tmp);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /set MODEL_PROVIDER=openrouter/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('env sync writes the fixed dev agent port instead of a worktree-derived port', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));

  try {
    writeAgentFixture(tmp, 54521);
    mustRun('git', ['init'], tmp);

    const res = run('node', [cli, 'env', 'sync'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);

    const mobileEnv = readFileSync(path.join(tmp, 'apps', 'mobile', '.env'), 'utf8');
    const agentEnv = readFileSync(path.join(tmp, 'supabase', '.env'), 'utf8');
    assert.match(mobileEnv, new RegExp(`^EXPO_PUBLIC_AGENT_URL=http://127\\.0\\.0\\.1:${TEST_AGENT_PORT}$`, 'm'));
    assert.match(agentEnv, new RegExp(`^AGENT_PORT=${TEST_AGENT_PORT}$`, 'm'));
    assert.notEqual(e2eAgentPort(tmp), agentPort(tmp));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('env sync honors the INCIPEL_DEV_AGENT_PORT override for the dev agent port', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));

  try {
    writeAgentFixture(tmp, 54521);
    mustRun('git', ['init'], tmp);

    const res = run('node', [cli, 'env', 'sync'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`, INCIPEL_DEV_AGENT_PORT: '49876' },
    });
    assert.equal(res.status, 0, res.stderr);

    const mobileEnv = readFileSync(path.join(tmp, 'apps', 'mobile', '.env'), 'utf8');
    const agentEnv = readFileSync(path.join(tmp, 'supabase', '.env'), 'utf8');
    assert.match(mobileEnv, /^EXPO_PUBLIC_AGENT_URL=http:\/\/127\.0\.0\.1:49876$/m);
    assert.match(agentEnv, /^AGENT_PORT=49876$/m);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dev asks to start the foreground agent on the next port when the configured port is occupied', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const occupiedPort = await findAvailablePortPair();
  const nextPort = occupiedPort + 1;
  const blocker = await startHealthServer(occupiedPort);
  const serveLog = path.join(tmp, 'serve.log');

  try {
    writeAgentFixture(tmp, 54521);
    makeFakeAgentDevExit(tmp);
    mustRun('git', ['init'], tmp);

    const res = spawnSync(process.execPath, [cli, 'dev'], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INCIPEL_DEV_AGENT_PORT: String(occupiedPort),
        INCIPEL_DEV_PROMPT_STDIN: '1',
      },
      input: 'y\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`agent 端口 ${occupiedPort} 已被占用`));
    assert.match(res.stdout, new RegExp(`本次 agent 改用端口 ${nextPort}`));

    const mobileEnv = readFileSync(path.join(tmp, 'apps', 'mobile', '.env'), 'utf8');
    const agentEnv = readFileSync(path.join(tmp, 'supabase', '.env'), 'utf8');
    const loggedServe = readFileSync(serveLog, 'utf8');
    assert.match(mobileEnv, new RegExp(`^EXPO_PUBLIC_AGENT_URL=http://127\\.0\\.0\\.1:${nextPort}$`, 'm'));
    assert.match(agentEnv, new RegExp(`^AGENT_PORT=${nextPort}$`, 'm'));
    assert.match(loggedServe, /pnpm --filter @incipel\/agent dev/);
    assert.match(loggedServe, new RegExp(`^AGENT_PORT=${nextPort}$`, 'm'));
  } finally {
    blocker.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('env sync keeps using the foreground agent fallback port chosen by dev', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const occupiedPort = await findAvailablePortPair();
  const nextPort = occupiedPort + 1;
  const blocker = await startHealthServer(occupiedPort);
  const serveLog = path.join(tmp, 'serve.log');

  try {
    writeAgentFixture(tmp, 54521);
    makeFakeAgentDevExit(tmp);
    mustRun('git', ['init'], tmp);

    const devRes = spawnSync(process.execPath, [cli, 'dev'], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INCIPEL_DEV_AGENT_PORT: String(occupiedPort),
        INCIPEL_DEV_PROMPT_STDIN: '1',
      },
      input: 'y\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(devRes.status, 0, devRes.stderr);

    const freshEnv = envWithout('INCIPEL_DEV_AGENT_PORT', 'DEV_AGENT_PORT');
    const syncRes = run('node', [cli, 'env', 'sync'], tmp, {
      env: { ...freshEnv, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(syncRes.status, 0, syncRes.stderr);

    const worktreeEnv = readFileSync(path.join(tmp, '.worktree-dev.env'), 'utf8');
    const mobileEnv = readFileSync(path.join(tmp, 'apps', 'mobile', '.env'), 'utf8');
    const agentEnv = readFileSync(path.join(tmp, 'supabase', '.env'), 'utf8');
    assert.match(worktreeEnv, new RegExp(`^DEV_AGENT_PORT=${nextPort}$`, 'm'));
    assert.match(mobileEnv, new RegExp(`^EXPO_PUBLIC_AGENT_URL=http://127\\.0\\.0\\.1:${nextPort}$`, 'm'));
    assert.match(agentEnv, new RegExp(`^AGENT_PORT=${nextPort}$`, 'm'));
  } finally {
    blocker.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dev exits instead of waiting when the configured agent port is occupied outside an interactive prompt', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const occupiedPort = await findAvailablePortPair();
  const blocker = await startHealthServer(occupiedPort);
  const serveLog = path.join(tmp, 'serve.log');

  try {
    writeAgentFixture(tmp, 54521);
    makeFakeAgentDevExit(tmp);
    mustRun('git', ['init'], tmp);

    const res = spawnSync(process.execPath, [cli, 'dev'], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INCIPEL_DEV_AGENT_PORT: String(occupiedPort),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, new RegExp(`agent 端口 ${occupiedPort} 已被占用`));
    assert.equal(existsSync(serveLog), false);
  } finally {
    blocker.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('e2e up writes a dedicated isolated agent port instead of reusing the dev agent port', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  try {
    mkdirSync(path.join(tmp, 'supabase'), { recursive: true });
    mkdirSync(path.join(tmp, 'bin'), { recursive: true });

    writeFileSync(
      path.join(tmp, 'supabase', 'config.toml'),
      [
        'project_id = "incipel"',
        '',
        '[api]',
        'port = 54521',
        '',
        '[studio]',
        'port = 54323',
        'api_url = "http://127.0.0.1:54521"',
        '',
      ].join('\n'),
    );
    writeFileSync(path.join(tmp, 'supabase', '.env'), 'MODEL_PROVIDER=stub\nOPENROUTER_API_KEY=sk-test\n');
    writeFileSync(
      path.join(tmp, 'bin', 'supabase'),
      [
        '#!/bin/sh',
        'if [ "$1" = "start" ] && [ "$2" = "--workdir" ]; then',
        '  exit 0',
        'fi',
        'if [ "$1" = "status" ] && [ "$2" = "--workdir" ] && [ "$4" = "-o" ] && [ "$5" = "json" ]; then',
        '  printf "%s\\n" \'{"API_URL":"http://127.0.0.1:54621","ANON_KEY":"anon","SERVICE_ROLE_KEY":"service","JWT_SECRET":"secret"}\'',
        '  exit 0',
        'fi',
        'printf "%s\\n" "unexpected supabase command: $*" >&2',
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    mustRun('git', ['init'], tmp);

    const res = run('node', [cli, 'e2e', 'up'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);

    const agentEnv = readFileSync(path.join(tmp, '.worktree-supabase', 'agent.env'), 'utf8');
    const envAgentPort = /^AGENT_PORT=(\d+)$/m.exec(agentEnv)?.[1];
    const printedAgentPort = /EXPO_PUBLIC_AGENT_URL\s+= http:\/\/127\.0\.0\.1:(\d+)/.exec(res.stdout)?.[1];

    assert.ok(envAgentPort, agentEnv);
    assert.equal(printedAgentPort, envAgentPort);
    assert.notEqual(Number(envAgentPort), agentPort(tmp));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts agent when env-file hash is missing despite healthy endpoint', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  const aPort = agentPort(tmp);

  try {
    mkdirSync(path.join(tmp, 'apps', 'mobile'), { recursive: true });
    mkdirSync(path.join(tmp, 'supabase'), { recursive: true });
    mkdirSync(path.join(tmp, 'bin'), { recursive: true });

    writeFileSync(path.join(tmp, 'supabase', 'config.toml'), ['project_id = "incipel"', '', '[api]', `port = ${port}`, ''].join('\n'));
    writeFileSync(
      path.join(tmp, 'apps', 'mobile', '.env'),
      [
        `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}`,
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon',
        `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:${aPort}`,
        'EXPO_PUBLIC_DEV_NO_AUTH=',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(tmp, 'supabase', '.env'),
      [
        'MODEL_PROVIDER=openrouter',
        'OPENROUTER_API_KEY=sk-test',
        `SUPABASE_URL=http://127.0.0.1:${port}`,
        'SUPABASE_SERVICE_ROLE_KEY=service',
        `AGENT_PORT=${aPort}`,
        `INCIPEL_SUPABASE_JWT_ISS=http://127.0.0.1:${port}/auth/v1`,
        'INCIPEL_SUPABASE_JWT_AUD=authenticated',
        'INCIPEL_SUPABASE_JWT_SECRET=secret',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(tmp, 'bin', 'supabase'),
      [
        '#!/bin/sh',
        'if [ "$1" = "status" ]; then',
        '  if [ "$2" = "-o" ] && [ "$3" = "json" ]; then',
      `    printf '%s\\n' '{"API_URL":"http://127.0.0.1:${port}","ANON_KEY":"anon","SERVICE_ROLE_KEY":"service","JWT_SECRET":"secret"}'`,
        '  else',
        '    printf "%s\\n" "supabase local development setup is running."',
        '  fi',
        '  exit 0',
        'fi',
        'printf "%s\\n" "unexpected supabase command: $*" >&2',
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    mustRun('git', ['init'], tmp);

    const res = run('node', [cli, 'up', '--dry-run'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent env-file 内容已变化,重启 agent server/);
    assert.match(res.stdout, /\[dry-run\] detached: pnpm --filter @incipel\/agent start/);
  } finally {
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts agent when healthy serve metadata belongs to another worktree', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify(
        {
          repoRoot: `${root}-other`,
          functionName: 'agent',
          pid: 12345,
          sourceHash: 'same-source',
          envHash: 'same-env',
          status: 'ready',
        },
        null,
        2,
      ),
    );

    const res = run('node', [cli, 'up', '--dry-run'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent serve metadata does not match current worktree, restarting/);
    assert.match(res.stdout, /\[dry-run\] detached: pnpm --filter @incipel\/agent start/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts agent when source hash changes despite healthy endpoint', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify(
        {
          repoRoot: root,
          functionName: 'agent',
          pid: 12345,
          sourceHash: 'stale-source',
          envHash: 'stale-env',
          status: 'ready',
        },
        null,
        2,
      ),
    );

    const res = run('node', [cli, 'up', '--dry-run'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent source\/env changed, restarting agent server/);
    assert.match(res.stdout, /\[dry-run\] detached: pnpm --filter @incipel\/agent start/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts agent when serve metadata records the old dev command despite healthy endpoint', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), command: 'pnpm --filter @incipel/agent dev' }, null, 2),
    );

    const res = run('node', [cli, 'up', '--dry-run'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent serve 启动命令已变化,重启 agent server/);
    assert.match(res.stdout, /\[dry-run\] detached: pnpm --filter @incipel\/agent start/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up writes current-worktree serve metadata when starting detached agent', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  const serveLog = path.join(tmp, 'serve.log');
  const dockerLog = path.join(tmp, 'docker.log');

  try {
    writeAgentFixture(tmp, port);
    makeFakeAgentServe(tmp, port);
    writeFakeDocker(tmp);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();

    const res = run('node', [cli, 'up'], tmp, {
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(readFileSync(serveLog, 'utf8'), /pnpm --filter @incipel\/agent start/);

    const meta = JSON.parse(readFileSync(metadataPaths(root).serveMeta, 'utf8'));
    assert.equal(meta.repoRoot, root);
    assert.equal(meta.functionName, 'agent');
    assert.equal(meta.command, 'pnpm --filter @incipel/agent start');
    assert.equal(typeof meta.pid, 'number');
    assert.equal(meta.logPath.endsWith(`incipel-agent-serve-${sha1(root).slice(0, 8)}.log`), true);
    assert.match(meta.sourceHash, /^[a-f0-9]{40}$/);
    assert.match(meta.envHash, /^[a-f0-9]{40}$/);
    assert.equal(meta.status, 'ready');
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run starts watcher when watcher metadata is missing', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(metadataPaths(root).serveMeta, JSON.stringify(matchingServeMetadata(root), null, 2));

    const res = run('node', [cli, 'up', '--dry-run'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent server 已在运行\(\/health 正常\),跳过/);
    assert.match(res.stdout, /确保 agent watcher 在监控当前 worktree/);
    assert.match(res.stdout, /\[dry-run\] detached: node .*tools\/incipel-dev\/cli\.mjs agent watch/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts watcher when watcher metadata belongs to another worktree', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(metadataPaths(root).serveMeta, JSON.stringify(matchingServeMetadata(root), null, 2));
    writeFileSync(
      metadataPaths(root).watcherMeta,
      JSON.stringify(
        {
          repoRoot: `${root}-other`,
          functionName: 'agent',
          pid: 12345,
          watchedPathsHash: matchingServeMetadata(root).watchedPathsHash,
        },
        null,
        2,
      ),
    );

    const res = run('node', [cli, 'up', '--dry-run'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent watcher metadata does not match current worktree, restarting/);
    assert.match(res.stdout, /\[dry-run\] detached: node .*tools\/incipel-dev\/cli\.mjs agent watch/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent watcher restarts serve once for repeated watched source changes', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  const serveLog = path.join(tmp, 'serve.log');
  const dockerLog = path.join(tmp, 'docker.log');
  let watcher;

  try {
    writeAgentFixture(tmp, port);
    makeFakeAgentServe(tmp, port);
    writeFakeDocker(tmp);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();

    watcher = spawn(process.execPath, [cli, 'agent', 'watch'], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitFor(() => existsSync(metadataPaths(root).watcherMeta));

    writeFileSync(path.join(tmp, 'packages', 'agent', 'src', 'app.ts'), 'export const app = "changed-1";\n');
    writeFileSync(path.join(tmp, 'packages', 'agent', 'src', 'app.ts'), 'export const app = "changed-2";\n');

    await waitFor(() => existsSync(serveLog) && readFileSync(serveLog, 'utf8').includes('pnpm --filter @incipel/agent start'));
    await sleep(1500);
    const serveLines = readFileSync(serveLog, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(serveLines.length, 1);
  } finally {
    if (watcher) watcher.kill('SIGTERM');
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent watcher ignores mobile docs tests and migration changes', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  const serveLog = path.join(tmp, 'serve.log');
  const dockerLog = path.join(tmp, 'docker.log');
  let watcher;

  try {
    writeAgentFixture(tmp, port);
    makeFakeAgentServe(tmp, port);
    writeFakeDocker(tmp);
    mkdirSync(path.join(tmp, 'apps', 'mobile', 'src'), { recursive: true });
    mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    mkdirSync(path.join(tmp, 'supabase', 'migrations'), { recursive: true });
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();

    watcher = spawn(process.execPath, [cli, 'agent', 'watch'], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitFor(() => existsSync(metadataPaths(root).watcherMeta));

    writeFileSync(path.join(tmp, 'apps', 'mobile', 'src', 'ignored.ts'), 'export const ignored = true;\n');
    writeFileSync(path.join(tmp, 'docs', 'ignored.md'), '# ignored\n');
    writeFileSync(path.join(tmp, 'supabase', 'migrations', '9999_ignored.sql'), 'select 1;\n');
    await sleep(1800);

    assert.equal(existsSync(serveLog), false);
  } finally {
    if (watcher) watcher.kill('SIGTERM');
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent stop dry-run stops only current-worktree metadata processes', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));

  try {
    writeAgentFixture(tmp, 54521);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: 11111, logPath: '/tmp/serve.log' }, null, 2),
    );
    writeFileSync(
      metadataPaths(root).watcherMeta,
      JSON.stringify(
        {
          repoRoot: root,
          functionName: 'agent',
          pid: 22222,
          logPath: '/tmp/watcher.log',
          watchedPathsHash: matchingServeMetadata(root).watchedPathsHash,
        },
        null,
        2,
      ),
    );

    const res = run('node', [cli, 'agent', 'stop', '--dry-run'], tmp);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\[dry-run\] kill 22222 \(agent watcher\)/);
    assert.match(res.stdout, /\[dry-run\] kill 11111 \(agent serve\)/);
    assert.match(res.stdout, /\/tmp\/watcher\.log/);
    assert.match(res.stdout, /\/tmp\/serve\.log/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent stop dry-run ignores metadata from another worktree', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));

  try {
    writeAgentFixture(tmp, 54521);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), repoRoot: `${root}-other`, pid: 11111 }, null, 2),
    );
    writeFileSync(
      metadataPaths(root).watcherMeta,
      JSON.stringify(
        {
          repoRoot: `${root}-other`,
          functionName: 'agent',
          pid: 22222,
          watchedPathsHash: matchingServeMetadata(root).watchedPathsHash,
        },
        null,
        2,
      ),
    );

    const res = run('node', [cli, 'agent', 'stop', '--dry-run'], tmp);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /没有可安全停止的当前 worktree agent 进程/);
    assert.doesNotMatch(res.stdout, /kill 11111/);
    assert.doesNotMatch(res.stdout, /kill 22222/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent stop does not signal an unrelated process even when metadata points to current worktree', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const dockerLog = path.join(tmp, 'docker.log');
  let unrelated;

  try {
    writeAgentFixture(tmp, 54521);
    writeFakeDocker(tmp);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitFor(() => isProcessAlive(unrelated.pid));

    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: unrelated.pid, logPath: '/tmp/serve.log' }, null, 2),
    );

    const res = run('node', [cli, 'agent', 'stop'], tmp, {
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.equal(isProcessAlive(unrelated.pid), true);
    assert.equal(existsSync(dockerLog), false);
  } finally {
    await stopChild(unrelated);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent stop does not signal agent-looking processes from another cwd', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const other = mkdtempSync(path.join(tmpdir(), 'incipel-dev-other-'));
  const dockerLog = path.join(tmp, 'docker.log');
  let otherServe;
  let otherWatcher;

  try {
    writeAgentFixture(tmp, 54521);
    writeFakeDocker(tmp);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    otherServe = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'pnpm', '--filter', '@incipel/agent', 'dev'], {
      cwd: other,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    otherWatcher = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', cli, 'agent', 'watch'], {
      cwd: other,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitFor(() => isProcessAlive(otherServe.pid) && isProcessAlive(otherWatcher.pid));

    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: otherServe.pid, logPath: '/tmp/serve.log' }, null, 2),
    );
    writeFileSync(
      metadataPaths(root).watcherMeta,
      JSON.stringify(
        {
          repoRoot: root,
          functionName: 'agent',
          pid: otherWatcher.pid,
          logPath: '/tmp/watcher.log',
          watchedPathsHash: matchingServeMetadata(root).watchedPathsHash,
        },
        null,
        2,
      ),
    );

    const res = run('node', [cli, 'agent', 'stop'], tmp, {
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(isProcessAlive(otherServe.pid), true);
    assert.equal(isProcessAlive(otherWatcher.pid), true);
    assert.equal(existsSync(dockerLog), false);
  } finally {
    await stopChild(otherServe);
    await stopChild(otherWatcher);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('agent stop stops a current-worktree serve started via the start script', { skip: !hasLsof() }, async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  let serve;

  try {
    writeAgentFixture(tmp, 54521);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    serve = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', 'pnpm', '--filter', '@incipel/agent', 'start'],
      { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] },
    );
    await waitFor(() => isProcessAlive(serve.pid));

    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: serve.pid, logPath: '/tmp/serve.log' }, null, 2),
    );

    const res = run('node', [cli, 'agent', 'stop'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    await waitFor(() => !isProcessAlive(serve.pid), { timeoutMs: 3000 });
  } finally {
    await stopChild(serve);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent stop cleans current-worktree agent listener when metadata pid is stale', { skip: !hasLsof() }, async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const dockerLog = path.join(tmp, 'docker.log');
  let listener;

  try {
    writeAgentFixture(tmp, 54521);
    writeFakeDocker(tmp);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    listener = await startAgentLikeHealthServer(root);
    assert.equal(listener.port, agentPort(root));

    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: 999999, logPath: '/tmp/serve.log' }, null, 2),
    );

    const res = run('node', [cli, 'agent', 'stop'], tmp, {
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
    });
    assert.equal(res.status, 0, res.stderr);
    await waitFor(() => listener.child.exitCode !== null || listener.child.signalCode !== null, {
      timeoutMs: 3000,
      intervalMs: 100,
    });
  } finally {
    await stopChild(listener?.child);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('agent stop --all stops tracked and orphan agents across worktrees but spares outsiders', { skip: !hasLsof() }, async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'incipel-dev-outside-'));
  const child = path.join(tmp, 'child');
  let mainServe;
  let childOrphan;
  let outsider;

  try {
    writeAgentFixture(tmp, 54521);
    mustRun('git', ['init'], tmp);
    mustRun('git', ['add', '-A'], tmp);
    mustRun('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();
    mustRun('git', ['worktree', 'add', '-b', 'child', child], tmp);
    const childRoot = mustRun('git', ['rev-parse', '--show-toplevel'], child).stdout.trim();

    const spawnAgentLike = (cwd) =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'pnpm', '--filter', '@incipel/agent', 'start'], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    mainServe = spawnAgentLike(root);
    childOrphan = spawnAgentLike(childRoot);
    outsider = spawnAgentLike(outside);
    await waitFor(() => isProcessAlive(mainServe.pid) && isProcessAlive(childOrphan.pid) && isProcessAlive(outsider.pid));

    // main worktree's serve is tracked in metadata; child's orphan is NOT tracked.
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: mainServe.pid, logPath: '/tmp/serve.log' }, null, 2),
    );

    const res = run('node', [cli, 'agent', 'stop', '--all'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    await waitFor(() => !isProcessAlive(mainServe.pid), { timeoutMs: 3000 });
    await waitFor(() => !isProcessAlive(childOrphan.pid), { timeoutMs: 3000 });
    assert.equal(isProcessAlive(outsider.pid), true);
  } finally {
    await stopChild(mainServe);
    await stopChild(childOrphan);
    await stopChild(outsider);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    rmSync(tmp, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('up stops the old watcher before replacing stale watcher metadata', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  let oldWatcher;
  let fakeServe;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();

    oldWatcher = spawn(process.execPath, [cli, 'agent', 'watch'], {
      cwd: tmp,
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitFor(() => existsSync(metadataPaths(root).watcherMeta));
    const oldPid = oldWatcher.pid;

    const staleWatcherMeta = JSON.parse(readFileSync(metadataPaths(root).watcherMeta, 'utf8'));
    staleWatcherMeta.watchedPathsHash = 'stale-watched-paths';
    writeFileSync(metadataPaths(root).watcherMeta, JSON.stringify(staleWatcherMeta, null, 2));

    fakeServe = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'pnpm', '--filter', '@incipel/agent', 'dev'], {
      cwd: tmp,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitFor(() => isProcessAlive(fakeServe.pid));
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: fakeServe.pid }, null, 2),
    );

    const res = run('node', [cli, 'up'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    await waitFor(() => !isProcessAlive(oldPid), { timeoutMs: 3000, intervalMs: 100 });
  } finally {
    await stopChild(oldWatcher);
    await stopChild(fakeServe);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up does not stop stale watcher metadata when pid belongs to another cwd', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const other = mkdtempSync(path.join(tmpdir(), 'incipel-dev-other-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  let otherWatcher;
  let fakeServe;

  try {
    writeAgentFixture(tmp, port);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();

    otherWatcher = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', cli, 'agent', 'watch'], {
      cwd: other,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    fakeServe = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'pnpm', '--filter', '@incipel/agent', 'dev'], {
      cwd: tmp,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitFor(() => isProcessAlive(otherWatcher.pid) && isProcessAlive(fakeServe.pid));

    writeFileSync(
      metadataPaths(root).watcherMeta,
      JSON.stringify(
        {
          repoRoot: root,
          functionName: 'agent',
          pid: otherWatcher.pid,
          logPath: '/tmp/watcher.log',
          watchedPathsHash: 'stale-watched-paths',
        },
        null,
        2,
      ),
    );
    writeFileSync(
      metadataPaths(root).serveMeta,
      JSON.stringify({ ...matchingServeMetadata(root), pid: fakeServe.pid }, null, 2),
    );

    const res = run('node', [cli, 'up'], tmp, {
      env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stderr);
    await sleep(500);
    assert.equal(otherWatcher.signalCode, null);
    assert.equal(isProcessAlive(otherWatcher.pid), true);
  } finally {
    await stopChild(otherWatcher);
    await stopChild(fakeServe);
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('up stops stale serve using metadata pid when pid file is missing', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer(agentPort(tmp));
  const port = health.port;
  const serveLog = path.join(tmp, 'serve.log');
  const dockerLog = path.join(tmp, 'docker.log');
  let oldPid;

  try {
    writeAgentFixture(tmp, port);
    makeFakeAgentServe(tmp, port);
    writeFakeDocker(tmp);
    mustRun('git', ['init'], tmp);
    const root = mustRun('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim();

    const first = run('node', [cli, 'up'], tmp, {
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
    });
    assert.equal(first.status, 0, first.stderr);
    oldPid = JSON.parse(readFileSync(metadataPaths(root).serveMeta, 'utf8')).pid;
    assert.equal(isProcessAlive(oldPid), true);

    rmSync(metadataPaths(root).servePid, { force: true });
    writeFileSync(path.join(tmp, 'packages', 'agent', 'src', 'app.ts'), 'export const app = "changed";\n');

    const second = run('node', [cli, 'up'], tmp, {
      env: {
        ...process.env,
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        INC_TEST_SERVE_LOG: serveLog,
        INC_TEST_DOCKER_LOG: dockerLog,
      },
    });
    assert.equal(second.status, 0, second.stderr);
    await waitFor(() => !isProcessAlive(oldPid), { timeoutMs: 3000, intervalMs: 100 });
  } finally {
    if (oldPid && isProcessAlive(oldPid)) {
      try {
        process.kill(oldPid, 'SIGTERM');
      } catch {
        // Process may have already exited.
      }
    }
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});
