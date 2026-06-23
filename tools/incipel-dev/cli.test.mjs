import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');

function run(bin, args, cwd, options = {}) {
  return spawnSync(bin, args, {
    cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function mustRun(bin, args, cwd) {
  const res = run(bin, args, cwd);
  assert.equal(res.status, 0, `${bin} ${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
  return res;
}

function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

function metadataPaths(root) {
  const token = sha1(root).slice(0, 8);
  return {
    serveMeta: path.join(tmpdir(), `incipel-agent-serve-${token}.json`),
  };
}

function cleanupMetadata(root) {
  rmSync(metadataPaths(root).serveMeta, { force: true });
}

function writeAgentFixture(root, port) {
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
      `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:${port}/functions/v1/agent`,
      'EXPO_PUBLIC_DEV_NO_AUTH=',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'supabase', '.env'),
    [
      'MODEL_PROVIDER=openrouter',
      'OPENROUTER_API_KEY=sk-test',
      `INCIPEL_SUPABASE_JWT_ISS=http://127.0.0.1:${port}/auth/v1`,
      'INCIPEL_SUPABASE_JWT_AUD=authenticated',
      'INCIPEL_SUPABASE_JWT_SECRET=secret',
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(root, 'supabase', 'functions', 'agent', 'index.ts'), 'Deno.serve(() => new Response("ok"));\n');
  writeFileSync(path.join(root, 'supabase', 'functions', 'agent', 'deno.json'), '{"imports":{}}\n');
  writeFileSync(path.join(root, 'packages', 'agent', 'src', 'app.ts'), 'export const app = "agent";\n');
  writeFileSync(path.join(root, 'packages', 'agent', 'model.config.json'), '{"provider":"stub"}\n');
  writeFileSync(path.join(root, 'packages', 'shared', 'src', 'tools.ts'), 'export const tools = [];\n');
  writeFileSync(
    path.join(root, 'bin', 'supabase'),
    [
      '#!/bin/sh',
      'if [ "$1" = "status" ]; then',
      '  if [ "$2" = "-o" ] && [ "$3" = "json" ]; then',
      `    printf '%s\\n' '{"API_URL":"http://127.0.0.1:${port}","ANON_KEY":"anon","JWT_SECRET":"secret"}'`,
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

async function startHealthServer() {
  const child = spawn(
    process.execPath,
    [
      '-e',
      [
        'const http = require("node:http");',
        'const server = http.createServer((req, res) => {',
        '  if (req.url === "/functions/v1/agent/health") {',
        '    res.writeHead(200, { "Content-Type": "application/json" });',
        '    res.end("{\\"ok\\":true}");',
        '    return;',
        '  }',
        '  res.writeHead(404);',
        '  res.end();',
        '});',
        'server.listen(0, "127.0.0.1", () => console.log(server.address().port));',
      ].join('\n'),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (buf) => resolve(Number(String(buf).trim())));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`health server exited with ${code}`));
    });
  });
  return { child, port };
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
        'EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:54521/functions/v1/agent',
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

test('up dry-run restarts agent when env-file hash is missing despite healthy endpoint', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer();
  const port = health.port;

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
        `EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:${port}/functions/v1/agent`,
        'EXPO_PUBLIC_DEV_NO_AUTH=',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(tmp, 'supabase', '.env'),
      [
        'MODEL_PROVIDER=openrouter',
        'OPENROUTER_API_KEY=sk-test',
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
        `    printf '%s\\n' '{"API_URL":"http://127.0.0.1:${port}","ANON_KEY":"anon","JWT_SECRET":"secret"}'`,
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
    assert.match(res.stdout, /agent env-file 内容已变化,重启 agent edge runtime/);
    assert.match(res.stdout, /\[dry-run\] docker stop supabase_edge_runtime_incipel/);
    assert.match(res.stdout, /\[dry-run\] detached: supabase functions serve agent --env-file supabase\/\.env --no-verify-jwt/);
  } finally {
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts agent when healthy serve metadata belongs to another worktree', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer();
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
    assert.match(res.stdout, /\[dry-run\] detached: supabase functions serve agent --env-file supabase\/\.env --no-verify-jwt/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('up dry-run restarts agent when source hash changes despite healthy endpoint', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'incipel-dev-test-'));
  const health = await startHealthServer();
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
    assert.match(res.stdout, /agent source\/env changed, restarting agent edge runtime/);
    assert.match(res.stdout, /\[dry-run\] docker stop supabase_edge_runtime_incipel/);
    assert.match(res.stdout, /\[dry-run\] detached: supabase functions serve agent --env-file supabase\/\.env --no-verify-jwt/);
  } finally {
    const root = run('git', ['rev-parse', '--show-toplevel'], tmp).stdout.trim() || tmp;
    cleanupMetadata(root);
    health.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});
