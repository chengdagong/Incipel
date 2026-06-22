#!/usr/bin/env bash
# 在「本 worktree 选定」的 Android 设备/模拟器上,用「本 worktree 专属」的 Metro 端口启动开发。
#
#   bash scripts/dev-android.sh                # Expo Go(默认)
#   bash scripts/dev-android.sh --dev-client   # development build
#
# 并行多 AVD 的前置(每个 worktree 一台,serial 各不相同):
#   emulator -list-avds
#   emulator -avd <名字> -port 5556            # serial 即 emulator-5556;再起一台用 5558,以此类推
#
# 关键点:Metro 端口要靠 `adb -s <serial> reverse` 转发进「指定」那台设备;每条 adb
# 命令都带 -s,避免多设备时打到错误的 serial。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/worktree-dev-env.sh
. "$SCRIPT_DIR/lib/worktree-dev-env.sh"

DEV_CLIENT=0
for arg in "$@"; do
  case "$arg" in
    --dev-client|-d) DEV_CLIENT=1 ;;
  esac
done

APP_SCHEME="${APP_SCHEME:-incipel}"
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
echo "▸ Metro 端口   : $EXPO_PORT"
echo "▸ Agent        : edge function(共用栈 /functions/v1/agent;本脚本会自动起栈并后台 serve)"
echo "▸ Android 设备 : $ANDROID_SERIAL"

# 起共用 Supabase 栈 + 后台 serve agent edge function(已在跑则自动跳过)。
# 设 INCIPEL_SKIP_AGENT=1 可跳过(例如你在另一个终端用 `pnpm dev:agent` 前台跑 agent)。
if [ "${INCIPEL_SKIP_AGENT:-0}" != "1" ]; then
  node "$REPO_ROOT/tools/incipel-dev/cli.mjs" up
fi

# 把本 worktree 的端口转发进「这台」设备(带 -s,避免打错)。Android 模拟器的 localhost 是
# 模拟器自身,这几条 reverse 让设备上的 localhost:<port> 直达宿主机,从而与 iOS 行为一致:
#   - Metro:加载 bundle
#   - Supabase / Agent:共用本地栈的 API 端口(agent edge function 挂在它的 /functions/v1/agent
#     下,见 ADR-0008;reverse 这一个端口就同时覆盖 EXPO_PUBLIC_SUPABASE_URL 与 EXPO_PUBLIC_AGENT_URL)。
adb -s "$ANDROID_SERIAL" reverse tcp:"$EXPO_PORT" tcp:"$EXPO_PORT"
SUPA_PORT="$(awk '/^\[api\]/{f=1} f&&/^port[[:space:]]*=/{gsub(/[^0-9]/,""); print; exit}' "$REPO_ROOT/supabase/config.toml" 2>/dev/null || true)"
if [ -n "${SUPA_PORT:-}" ]; then
  adb -s "$ANDROID_SERIAL" reverse tcp:"$SUPA_PORT" tcp:"$SUPA_PORT" >/dev/null 2>&1 || true
fi

cd "$REPO_ROOT/apps/mobile"

(
  url="exp://127.0.0.1:$EXPO_PORT"
  [ "$DEV_CLIENT" -eq 1 ] && url="$APP_SCHEME://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$EXPO_PORT"
  for _ in $(seq 1 90); do
    if curl -sf "http://127.0.0.1:$EXPO_PORT/status" >/dev/null 2>&1; then
      if [ "$DEV_CLIENT" -eq 0 ] && ! adb -s "$ANDROID_SERIAL" shell pm path "$EXPO_GO_PKG" >/dev/null 2>&1; then
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

if [ "$DEV_CLIENT" -eq 1 ]; then
  exec npx expo start --port "$EXPO_PORT" --dev-client
else
  exec npx expo start --port "$EXPO_PORT" --go
fi
