#!/usr/bin/env bash
# 被 scripts/dev-ios.sh / scripts/dev-android.sh 通过 `source` 引入。
#
# 职责:确定「本 worktree」的开发隔离参数,并持久化到本 worktree 根目录的
# .worktree-dev.env(该文件已被 .gitignore 忽略,每个 worktree 各持一份)。
#   - EXPO_PORT          : 本 worktree 的 Metro 端口;首次自动分配,避开其它 worktree 与当前在监听的端口
#   - IOS_SIMULATOR_NAME : 本 worktree 专属 iOS 模拟器名;首次由分支名派生
#   - ANDROID_SERIAL     : Android 目标 serial;留空交由 dev-android.sh 自动判定
#
# 兼容 macOS 自带的 bash 3.2,不使用 mapfile/readarray 等 bash 4 特性。

REPO_ROOT="$(git rev-parse --show-toplevel)"
ENV_FILE="$REPO_ROOT/.worktree-dev.env"

# 1) 载入已有配置
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# 2) 端口分配:挑一个「未被其它 worktree 声明、且当前未被监听」的最低端口
port_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

ports_claimed_by_other_worktrees() {
  git worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{print $2}' \
    | while IFS= read -r wt; do
        f="$wt/.worktree-dev.env"
        [ "$f" = "$ENV_FILE" ] && continue
        [ -f "$f" ] && grep -E '^EXPO_PORT=' "$f" | head -1 | sed 's/^EXPO_PORT=//; s/"//g'
      done
}

allocate_port() {
  local claimed candidate
  # 前后各补一个空格,便于用 case 做整词匹配
  claimed=" $(ports_claimed_by_other_worktrees | tr '\n' ' ') "
  candidate=8081
  while [ "$candidate" -lt 8200 ]; do
    case "$claimed" in
      *" $candidate "*) candidate=$((candidate + 1)); continue ;;
    esac
    if port_is_listening "$candidate"; then
      candidate=$((candidate + 1))
      continue
    fi
    echo "$candidate"
    return 0
  done
  echo 8081
}

if [ -z "${EXPO_PORT:-}" ]; then
  EXPO_PORT="$(allocate_port)"
fi

# 3) iOS 模拟器名:缺省则由分支名派生(把 / 与非字母数字折成 -)
if [ -z "${IOS_SIMULATOR_NAME:-}" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null | tr '/' '-' | tr -cd '[:alnum:]_-')"
  [ -z "$branch" ] && branch="$(basename "$REPO_ROOT")"
  IOS_SIMULATOR_NAME="incipel-${branch}"
fi

ANDROID_SERIAL="${ANDROID_SERIAL:-}"

# 4) 写回:持久化首次分配,后续保持稳定
cat > "$ENV_FILE" <<EOF
# 本 worktree 的开发隔离配置(由 scripts/lib/worktree-dev-env.sh 自动生成,可手改)。
# 该文件已被 .gitignore 忽略,每个 worktree 各持一份。说明见 docs/worktree-dev.md。
EXPO_PORT=$EXPO_PORT
IOS_SIMULATOR_NAME="$IOS_SIMULATOR_NAME"
# 留空则 dev-android.sh 在仅一台 emulator 在线时自动选用;多台在线时请填 adb serial(如 emulator-5556)。
ANDROID_SERIAL="$ANDROID_SERIAL"
EOF

export REPO_ROOT ENV_FILE EXPO_PORT IOS_SIMULATOR_NAME ANDROID_SERIAL
