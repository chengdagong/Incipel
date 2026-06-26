#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_IOS="$ROOT/scripts/dev-ios.sh"
DEV_ANDROID="$ROOT/scripts/dev-android.sh"
E2E_IOS="$ROOT/scripts/e2e-ios.sh"
WORKTREE_ENV="$ROOT/scripts/lib/worktree-dev-env.sh"
PACKAGE_JSON="$ROOT/package.json"
INC_DEV="$ROOT/tools/incipel-dev/cli.mjs"

fail() {
  echo "✗ $1" >&2
  exit 1
}

line_number() {
  pattern="$1"
  file="$2"
  grep -nF "$pattern" "$file" | head -1 | cut -d: -f1 || true
}

require_contains() {
  file="$1"
  pattern="$2"
  message="$3"
  grep -Fq "$pattern" "$file" || fail "$message"
}

require_not_contains() {
  file="$1"
  pattern="$2"
  message="$3"
  if grep -Fq "$pattern" "$file"; then
    fail "$message"
  fi
}

require_contains "$PACKAGE_JSON" '"dev:web": "node tools/incipel-dev/cli.mjs web"' "根 package.json 应提供 pnpm dev:web。"
require_not_contains "$WORKTREE_ENV" 'EXPO_PORT=8081' "worktree-dev-env.sh 不应再固定 Metro 端口 8081。"
require_contains "$DEV_IOS" 'METRO_PORT="$(node "$REPO_ROOT/tools/incipel-dev/cli.mjs" metro port)"' "dev-ios.sh 应为本次命令选择 Metro 端口。"
require_contains "$DEV_ANDROID" 'METRO_PORT="$(node "$REPO_ROOT/tools/incipel-dev/cli.mjs" metro port)"' "dev-android.sh 应为本次命令选择 Metro 端口。"
require_contains "$DEV_ANDROID" 'adb -s "$ANDROID_SERIAL" reverse tcp:"$METRO_PORT" tcp:"$METRO_PORT"' "dev-android.sh 应把所选 Metro 端口转发到目标设备。"
require_not_contains "$E2E_IOS" 'expo start' "e2e-ios.sh 不应启动 Metro。"
require_contains "$INC_DEV" "'--web'," "dev:web 应以 Expo Web 模式启动。"
require_contains "$INC_DEV" "'--localhost'," "dev:web 应限制在 localhost。"
require_contains "$INC_DEV" "'--port', String(metroPort)" "dev:web 应使用所选 Metro 端口。"
require_contains "$INC_DEV" "waitForMetroStatus(metroPort)" "dev:web 应等待 Metro /status 可访问后再打印 URL。"

source_line="$(line_number '. "$SCRIPT_DIR/lib/worktree-dev-env.sh"' "$DEV_IOS")"
target_line="$(line_number 'IOS_SIMULATOR_NAME="incipel-development"' "$DEV_IOS")"

[ -n "$source_line" ] || fail "dev-ios.sh 没有读取 worktree 开发配置。"
[ -n "$target_line" ] || fail "dev-ios.sh 没有把 development simulator 固定为 incipel-development。"
[ "$target_line" -gt "$source_line" ] || fail "dev-ios.sh 必须在读取 worktree 配置后覆盖 iOS simulator 名称。"

for script in "$DEV_IOS" "$DEV_ANDROID"; do
  if ! grep -Fq 'tools/incipel-dev/cli.mjs" env sync' "$script"; then
    fail "$(basename "$script") 应只准备共用 Supabase 栈和 env,不应启动或检查 agent。"
  fi
  if grep -Fq 'tools/incipel-dev/cli.mjs" up' "$script"; then
    fail "$(basename "$script") 不应调用 up,因为 up 会启动或检查 agent。"
  fi
  if grep -Fq 'INCIPEL_SKIP_AGENT' "$script"; then
    fail "$(basename "$script") 不应再用 INCIPEL_SKIP_AGENT 分支管理 agent。"
  fi
done

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

if ! grep -Fq 'OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}' "$ROOT/.github/workflows/ci.yml"; then
  fail "CI 的 pnpm -r test step 应注入 OPENROUTER_API_KEY secret。"
fi

if ! grep -Fq 'MODEL_PROVIDER=openrouter' "$E2E_IOS"; then
  fail "e2e-ios.sh 的 real-ai 层应使用 MODEL_PROVIDER=openrouter。"
fi

if ! grep -Fq 'OPENROUTER_API_KEY' "$E2E_IOS"; then
  fail "e2e-ios.sh 的 real-ai 层应检查 OPENROUTER_API_KEY。"
fi

if ! grep -Fq 'DEV_AGENT_PORT=4111' "$WORKTREE_ENV"; then
  fail "dev agent 端口默认值应为 4111。"
fi

if ! grep -Fq 'DEV_AGENT_PORT="$DEV_AGENT_PORT"' "$WORKTREE_ENV"; then
  fail "worktree-dev-env.sh 应保留 dev:agent 选定的 fallback 端口。"
fi

if ! grep -Fq 'E2E_AGENT_PORT=' "$WORKTREE_ENV"; then
  fail "worktree-dev-env.sh 应导出 worktree 相关的 E2E_AGENT_PORT。"
fi

if ! grep -Fq 'E2E_EFFECTIVE_AGENT_PORT="$E2E_AGENT_PORT"' "$E2E_IOS"; then
  fail "e2e-ios.sh 应默认使用 E2E_AGENT_PORT,避免占用 dev agent 端口。"
fi

if ! grep -Fq 'AGENT_PORT="$E2E_EFFECTIVE_AGENT_PORT"' "$E2E_IOS"; then
  fail "e2e-ios.sh 应使用 E2E_AGENT_PORT,避免占用 dev agent 端口。"
fi

echo "✓ dev-ios simulator target checks passed"
