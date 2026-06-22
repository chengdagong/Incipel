import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');

function run(bin, args, cwd) {
  return spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function mustRun(bin, args, cwd) {
  const res = run(bin, args, cwd);
  assert.equal(res.status, 0, `${bin} ${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
  return res;
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
