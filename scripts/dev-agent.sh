#!/usr/bin/env bash
# 在「本 worktree 专属」的 agent 端口上启动 agent(Hono / AG-UI)开发服务。
#
#   bash scripts/dev-agent.sh
#
# 端口由 scripts/lib/worktree-dev-env.sh 分配,并已写进 packages/agent/.env 的 PORT;
# 这里再以环境变量显式传入,双保险(agent 读 process.env.PORT ?? 8787)。
# Supabase 默认走「共用一套本地栈」:packages/agent/.env 里填的 SUPABASE_URL 指向那一套;
# 若该 worktree 不需要持久化,在 packages/agent/.env 设 STORE=memory、DEV_NO_AUTH=1 即可不连 Supabase。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/worktree-dev-env.sh
. "$SCRIPT_DIR/lib/worktree-dev-env.sh"

echo "▸ worktree   : $REPO_ROOT"
echo "▸ Agent 端口 : $AGENT_PORT  (http://localhost:$AGENT_PORT)"

cd "$REPO_ROOT"
exec env PORT="$AGENT_PORT" pnpm --filter @incipel/agent dev
