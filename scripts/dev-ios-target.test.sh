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

echo "✓ dev-ios simulator target checks passed"
