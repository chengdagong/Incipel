#!/usr/bin/env bash
# 在「本 worktree 选定」的 Android 设备/模拟器上,用本次选择的 Metro 端口启动开发。
#
#   bash scripts/dev-android.sh --go          # Expo Go
#   bash scripts/dev-android.sh --devbuild    # development build
#
# 并行多 AVD 的前置(每个 worktree 一台,serial 各不相同):
#   emulator -list-avds
#   emulator -avd <名字> -port 5556            # serial 即 emulator-5556;再起一台用 5558,以此类推
#
# 关键点:Metro 端口要靠 `adb -s <serial> reverse` 转发进「指定」那台设备;每条 adb
# 命令都带 -s,避免多设备时打到错误的 serial。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
用法:
  bash scripts/dev-android.sh --go          # Expo Go
  bash scripts/dev-android.sh --devbuild    # development build

通过 pnpm:
  pnpm dev:android -- --go
  pnpm dev:android -- --devbuild
EOF
}

MODE=""
for arg in "$@"; do
  case "$arg" in
    --go)
      if [ -n "$MODE" ]; then
        echo "✗ 只能在 --go 与 --devbuild 中选择一个。"
        usage
        exit 2
      fi
      MODE="go"
      ;;
    --devbuild)
      if [ -n "$MODE" ]; then
        echo "✗ 只能在 --go 与 --devbuild 中选择一个。"
        usage
        exit 2
      fi
      MODE="devbuild"
      ;;
    --dev-client|-d)
      echo "✗ 参数 $arg 已停用,请改用 --devbuild。"
      usage
      exit 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "✗ 未知参数: $arg"
      usage
      exit 2
      ;;
  esac
done
if [ -z "$MODE" ]; then
  echo "✗ 必须明确指定 --go 或 --devbuild。"
  usage
  exit 2
fi
DEVBUILD=0
[ "$MODE" = "devbuild" ] && DEVBUILD=1

# shellcheck source=lib/worktree-dev-env.sh
. "$SCRIPT_DIR/lib/worktree-dev-env.sh"

APP_SCHEME="${APP_SCHEME:-incipel}"
ANDROID_APP_ID="${ANDROID_APP_ID:-com.incipel.app}"
EXPO_GO_PKG="host.exp.exponent"

online_devices() { adb devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}'; }

# 选定目标 serial:.worktree-dev.env 未指定时,仅一台在线则自动选用,多台则报错
if [ -z "${ANDROID_SERIAL:-}" ]; then
  devs="$(online_devices || true)"
  count="$(printf '%s\n' "$devs" | grep -c . || true)"
  if [ "$count" -eq 0 ]; then
    echo "✗ 没有在线的 Android 设备/模拟器。先启动一台 AVD,例如:"
    echo "    emulator -list-avds"
    echo "    emulator -avd <名字> -port 5556     # 每个 worktree 用不同 -port,serial 即 emulator-<port>"
    exit 1
  elif [ "$count" -gt 1 ]; then
    echo "✗ 有多台设备在线,请在 .worktree-dev.env 设 ANDROID_SERIAL 指定其一:"
    printf '    %s\n' "$devs"
    exit 1
  fi
  ANDROID_SERIAL="$devs"
fi

echo "▸ worktree     : $REPO_ROOT"
echo "▸ Supabase     : 共用本地 Supabase 栈(本脚本不会启动或检查 agent)"
echo "▸ Android 设备 : $ANDROID_SERIAL"

if [ "$DEVBUILD" -eq 1 ] && ! adb -s "$ANDROID_SERIAL" shell pm path "$ANDROID_APP_ID" >/dev/null 2>&1; then
  echo ""
  echo "▸ 该设备尚未安装 development build($ANDROID_APP_ID),正在构建并安装…"
  ( cd "$REPO_ROOT/apps/mobile" && npx expo run:android --device "$ANDROID_SERIAL" --no-bundler )
  echo "✓ development build 已安装到 $ANDROID_SERIAL"
fi

# 起共用 Supabase 栈 + 同步 apps/mobile/.env / supabase/.env;不启动或检查 agent。
node "$REPO_ROOT/tools/incipel-dev/cli.mjs" env sync
METRO_PORT="$(node "$REPO_ROOT/tools/incipel-dev/cli.mjs" metro port)"
echo "▸ Metro 端口   : $METRO_PORT"

# 把本 worktree 的端口转发进「这台」设备(带 -s,避免打错)。Android 模拟器的 localhost 是
# 模拟器自身,这几条 reverse 让设备上的 localhost:<port> 直达宿主机,从而与 iOS 行为一致:
#   - Metro:加载 bundle
#   - Supabase:共用本地栈的 API 端口
#   - Agent:apps/mobile/.env 中的 agent server 端口;这里仅做端口转发,不检查 agent 是否运行
adb -s "$ANDROID_SERIAL" reverse tcp:"$METRO_PORT" tcp:"$METRO_PORT"
SUPA_PORT="$(awk '/^\[api\]/{f=1} f&&/^port[[:space:]]*=/{gsub(/[^0-9]/,""); print; exit}' "$REPO_ROOT/supabase/config.toml" 2>/dev/null || true)"
if [ -n "${SUPA_PORT:-}" ]; then
  adb -s "$ANDROID_SERIAL" reverse tcp:"$SUPA_PORT" tcp:"$SUPA_PORT" >/dev/null 2>&1 || true
fi
AGENT_PORT="$(awk -F= '/^EXPO_PUBLIC_AGENT_URL=/{print $2}' "$REPO_ROOT/apps/mobile/.env" 2>/dev/null | sed -E 's#^https?://[^:/]+:([0-9]+).*#\1#' | head -1)"
if [[ "${AGENT_PORT:-}" =~ ^[0-9]+$ ]] && [ "$AGENT_PORT" != "$SUPA_PORT" ]; then
  adb -s "$ANDROID_SERIAL" reverse tcp:"$AGENT_PORT" tcp:"$AGENT_PORT" >/dev/null 2>&1 || true
fi

cd "$REPO_ROOT/apps/mobile"

(
  url="exp://127.0.0.1:$METRO_PORT"
  [ "$DEVBUILD" -eq 1 ] && url="$APP_SCHEME://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$METRO_PORT"
  for _ in $(seq 1 90); do
    if curl -sf "http://127.0.0.1:$METRO_PORT/status" >/dev/null 2>&1; then
      if [ "$DEVBUILD" -eq 0 ] && ! adb -s "$ANDROID_SERIAL" shell pm path "$EXPO_GO_PKG" >/dev/null 2>&1; then
        echo ""
        echo "ℹ 该设备尚未安装 Expo Go。首次请在下方 Metro 菜单按 a 安装(多设备时按 shift+a 选设备),"
        echo "  之后再次运行本脚本即可自动定向到这台设备。"
        exit 0
      fi
      if adb -s "$ANDROID_SERIAL" shell am start -a android.intent.action.VIEW -d "$url" >/dev/null 2>&1; then
        echo "✓ 已在 $ANDROID_SERIAL 打开 $url"
      else
        echo "ℹ 自动打开失败,可在 Metro 菜单按 a。"
      fi
      exit 0
    fi
    sleep 1
  done
) &

if [ "$DEVBUILD" -eq 1 ]; then
  exec npx expo start --port "$METRO_PORT" --dev-client
else
  exec npx expo start --port "$METRO_PORT" --go
fi
