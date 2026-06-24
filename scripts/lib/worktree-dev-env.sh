#!/usr/bin/env bash
# 被 scripts/dev-ios.sh / scripts/dev-android.sh 通过 `source` 引入。
#
# 职责:确定「本 worktree」的开发隔离参数(Metro 端口 / E2E iOS simulator 名 / Android serial),
# 持久化到本 worktree 根目录的 .worktree-dev.env(已被 .gitignore 忽略,每个 worktree 各持一份)。
#   - EXPO_PORT          : Metro 端口,固定 8081(我们总是只跑一个 dev 环境,不再 per-worktree 错开)
#   - DEV_AGENT_PORT     : 日常 dev agent server 端口,固定 4111(与 worktree 无关)
#   - E2E_AGENT_PORT     : E2E runner 的 agent server 端口,按 worktree 真实路径派生
#   - AGENT_PORT         : 兼容旧脚本的 dev agent server 端口,等于 DEV_AGENT_PORT
#   - IOS_SIMULATOR_NAME : pnpm e2e:ios 使用的本 worktree 专属 iOS simulator 名;由分支名派生
#   - ANDROID_SERIAL     : Android 目标 serial;留空交由 dev-android.sh 自动判定
#
# 写 apps/mobile/.env 与 supabase/.env、起共用栈、启动 Mastra Node agent server,统一交给
# `node tools/incipel-dev/cli.mjs up`(dev:ios / dev:android 会在起 Metro 前调它);本文件不碰 .env。
# dev agent 端口由 tools/incipel-dev 固定为 4111,并写入 apps/mobile/.env。
#
# 兼容 macOS 自带的 bash 3.2,不使用 mapfile/readarray 等 bash 4 特性。

REPO_ROOT="$(git rev-parse --show-toplevel)"
ENV_FILE="$REPO_ROOT/.worktree-dev.env"
ROOT_REALPATH="$(cd "$REPO_ROOT" && pwd -P)"
ROOT_HASH="$(printf '%s' "$ROOT_REALPATH" | shasum | awk '{print $1}')"
AGENT_HASH_PREFIX="${ROOT_HASH:0:4}"
DEV_AGENT_PORT=4111
E2E_AGENT_PORT=$((6111 + (16#$AGENT_HASH_PREFIX % 2000)))
AGENT_PORT="$DEV_AGENT_PORT"

set_env_var() {
  file="$1"
  key="$2"
  val="$3"
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || : > "$file"
  tmp="$(mktemp)"
  awk -v key="$key" -v val="$val" '
    BEGIN { done = 0 }
    index($0, key "=") == 1 { print key "=" val; done = 1; next }
    { print }
    END { if (!done) print key "=" val }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# 1) 载入已有配置
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# 1.5) 新 worktree 直接可运行:apps/mobile 任一直接依赖缺失时,先安装依赖。
#      Expo 会在读取 app.json 时解析 config plugin;只检查 expo 不足以发现新增 plugin 缺失。
#      pnpm 使用全局 content-addressable store,命中时通常只是创建硬链接,不会重复下载。
if ! MISSING_MOBILE_DEPS="$(
  MOBILE_DIR="$REPO_ROOT/apps/mobile" node <<'NODE'
const fs = require('fs');
const path = require('path');

const mobileDir = process.env.MOBILE_DIR;
const pkg = JSON.parse(fs.readFileSync(path.join(mobileDir, 'package.json'), 'utf8'));
const deps = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
};

const missing = Object.keys(deps).filter((name) => {
  return !fs.existsSync(path.join(mobileDir, 'node_modules', name));
});

if (missing.length > 0) {
  process.stdout.write(missing.slice(0, 5).join(', '));
  process.exit(1);
}
NODE
)"; then
  echo "▸ apps/mobile 缺依赖($MISSING_MOBILE_DEPS),先 pnpm install(pnpm store 命中通常几秒)…"
  ( cd "$REPO_ROOT" && pnpm install )
fi

# 2) Metro 端口:固定 8081。我们总是只跑一个 dev 环境,不再为每个 worktree 错开端口
#    (以前从 8081 起逐个避让分配,现已去掉)。这样直接 `expo start`(默认 8081)与本脚本一致。
#    放在载入 .worktree-dev.env 之后,覆盖旧文件里可能残留的分配值。要临时改端口,改这一行即可。
EXPO_PORT=8081

# 3) E2E iOS simulator 名:缺省则由分支名派生(把 / 与非字母数字折成 -)
if [ -z "${IOS_SIMULATOR_NAME:-}" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null | tr '/' '-' | tr -cd '[:alnum:]_-')"
  [ -z "$branch" ] && branch="$(basename "$REPO_ROOT")"
  IOS_SIMULATOR_NAME="incipel-${branch}"
fi

ANDROID_SERIAL="${ANDROID_SERIAL:-}"

# 4) 写回:持久化本 worktree 选定的设备项(端口是派生值,不入文件)。
cat > "$ENV_FILE" <<EOF
# 本 worktree 的开发隔离配置(由 scripts/lib/worktree-dev-env.sh 自动生成,可手改)。
# 该文件已被 .gitignore 忽略,每个 worktree 各持一份。说明见 docs/worktree-dev.md。
IOS_SIMULATOR_NAME="$IOS_SIMULATOR_NAME"
# 留空则 dev-android.sh 在仅一台 emulator 在线时自动选用;多台在线时请填 adb serial(如 emulator-5556)。
ANDROID_SERIAL="$ANDROID_SERIAL"
EOF

export REPO_ROOT ENV_FILE EXPO_PORT DEV_AGENT_PORT E2E_AGENT_PORT AGENT_PORT IOS_SIMULATOR_NAME ANDROID_SERIAL
