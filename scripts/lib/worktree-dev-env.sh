#!/usr/bin/env bash
# 被 scripts/dev-ios.sh / scripts/dev-android.sh / scripts/dev-agent.sh 通过 `source` 引入。
#
# 职责:确定「本 worktree」的开发隔离参数,持久化到本 worktree 根目录的 .worktree-dev.env
# (已被 .gitignore 忽略,每个 worktree 各持一份),并据此把 agent 端口与 URL 写进
# apps/mobile/.env 与 packages/agent/.env 的对应键——只动这两个工具自管的键,绝不碰任何密钥。
#   - EXPO_PORT          : 本 worktree 的 Metro 端口;8081 起分配
#   - AGENT_PORT         : 本 worktree 的 agent(Hono)端口;8787 起分配
#   - IOS_SIMULATOR_NAME : 本 worktree 专属 iOS 模拟器名;由分支名派生
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

# 2) 端口分配工具
port_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

# 收集其它 worktree 在各自 .worktree-dev.env 里已声明的某个端口键
claimed_ports() { # $1 = 键名(EXPO_PORT / AGENT_PORT)
  git worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{print substr($0, 10)}' \
    | while IFS= read -r wt; do
        f="$wt/.worktree-dev.env"
        [ "$f" = "$ENV_FILE" ] && continue
        [ -f "$f" ] && grep -E "^$1=" "$f" | head -1 | sed "s/^$1=//; s/\"//g"
      done
}

allocate_port() { # $1 = 键名, $2 = 起始端口
  local claimed candidate
  # 前后各补空格便于用 case 整词匹配;|| true 屏蔽管道在 pipefail 下的非零退出
  claimed=" $(claimed_ports "$1" | tr '\n' ' ' || true) "
  candidate="$2"
  while [ "$candidate" -lt "$(( $2 + 200 ))" ]; do
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
  echo "$2"
}

if [ -z "${EXPO_PORT:-}" ]; then EXPO_PORT="$(allocate_port EXPO_PORT 8081)"; fi
if [ -z "${AGENT_PORT:-}" ]; then AGENT_PORT="$(allocate_port AGENT_PORT 8787)"; fi

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
AGENT_PORT=$AGENT_PORT
IOS_SIMULATOR_NAME="$IOS_SIMULATOR_NAME"
# 留空则 dev-android.sh 在仅一台 emulator 在线时自动选用;多台在线时请填 adb serial(如 emulator-5556)。
ANDROID_SERIAL="$ANDROID_SERIAL"
EOF

# 5) 把工具自管的键写进 app 的 .env —— 只动这些键,绝不碰任何密钥。
# set_env_var FILE KEY VALUE:替换已有同名行,或在文件末尾追加;按整行前缀匹配,值含特殊字符也安全。
set_env_var() {
  local file="$1" key="$2" val="$3"
  [ -f "$file" ] || return 1
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v repl="$key=$val" 'index($0, k"=")==1{print repl; next} {print}' "$file" > "$file.tmp" \
      && mv "$file.tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

ensure_app_env_files() {
  local mobile_env="$REPO_ROOT/apps/mobile/.env"
  local agent_env="$REPO_ROOT/packages/agent/.env"

  # 缺省时从 .env.example 生成(只在不存在时),让密钥槽位显现,由用户填一次
  if [ ! -f "$mobile_env" ] && [ -f "$REPO_ROOT/apps/mobile/.env.example" ]; then
    cp "$REPO_ROOT/apps/mobile/.env.example" "$mobile_env"
    echo "ℹ 已生成 apps/mobile/.env(从 .env.example),请填入 EXPO_PUBLIC_SUPABASE_ANON_KEY。"
  fi
  if [ ! -f "$agent_env" ] && [ -f "$REPO_ROOT/packages/agent/.env.example" ]; then
    cp "$REPO_ROOT/packages/agent/.env.example" "$agent_env"
    echo "ℹ 已生成 packages/agent/.env(从 .env.example),请填 ANTHROPIC_API_KEY 等密钥;"
    echo "  仅做 UI/agent 迭代、不需持久化时,可设 STORE=memory、DEV_NO_AUTH=1 完全跳过 Supabase。"
  fi

  # 本 worktree 自管的路由键:客户端访问 agent 的 URL + agent 监听端口
  set_env_var "$mobile_env" EXPO_PUBLIC_AGENT_URL "http://localhost:$AGENT_PORT" 2>/dev/null || true
  set_env_var "$agent_env"  PORT "$AGENT_PORT" 2>/dev/null || true
}

ensure_app_env_files

export REPO_ROOT ENV_FILE EXPO_PORT AGENT_PORT IOS_SIMULATOR_NAME ANDROID_SERIAL
