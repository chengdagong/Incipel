#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_IOS="$ROOT/scripts/dev-ios.sh"
E2E_IOS="$ROOT/scripts/e2e-ios.sh"

fail() {
  echo "✗ $1" >&2
  exit 1
}

line_number() {
  pattern="$1"
  file="$2"
  grep -nF "$pattern" "$file" | head -1 | cut -d: -f1 || true
}

source_line="$(line_number '. "$SCRIPT_DIR/lib/worktree-dev-env.sh"' "$DEV_IOS")"
target_line="$(line_number 'IOS_SIMULATOR_NAME="incipel-development"' "$DEV_IOS")"

[ -n "$source_line" ] || fail "dev-ios.sh 没有读取 worktree 开发配置。"
[ -n "$target_line" ] || fail "dev-ios.sh 没有把 development simulator 固定为 incipel-development。"
[ "$target_line" -gt "$source_line" ] || fail "dev-ios.sh 必须在读取 worktree 配置后覆盖 iOS simulator 名称。"

if grep -Fq 'incipel-development' "$E2E_IOS"; then
  fail "e2e-ios.sh 不应改用共享 development simulator。"
fi

if grep -Fq 'packages/agent/.env' "$E2E_IOS"; then
  fail "e2e-ios.sh 不应再读取旧的 packages/agent/.env。"
fi

if ! grep -Fq 'supabase/.env' "$E2E_IOS"; then
  fail "e2e-ios.sh 应读取 tools/incipel-dev 管理的 supabase/.env。"
fi

if ! grep -Fq 'set -a' "$E2E_IOS"; then
  fail "e2e-ios.sh 启动 agent 前应显式导出 env-file。"
fi

if ! grep -Fq 'real-ai' "$E2E_IOS"; then
  fail "e2e-ios.sh 应支持 real-ai 层。"
fi

if ! grep -Fq 'MODEL_PROVIDER=openrouter' "$E2E_IOS"; then
  fail "e2e-ios.sh 的 real-ai 层应使用 MODEL_PROVIDER=openrouter。"
fi

if ! grep -Fq 'OPENROUTER_API_KEY' "$E2E_IOS"; then
  fail "e2e-ios.sh 的 real-ai 层应检查 OPENROUTER_API_KEY。"
fi

echo "✓ dev-ios simulator target checks passed"
