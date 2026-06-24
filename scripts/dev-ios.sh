#!/usr/bin/env bash
# 在所有 worktree 共用的 iOS development simulator 上,用固定 Metro 端口启动开发。
#
#   bash scripts/dev-ios.sh --go          # Expo Go
#   bash scripts/dev-ios.sh --devbuild    # development build
#
# 关键点:dev:ios 只使用一台机器级共享 simulator。脚本仍按 UDID 用 `simctl openurl`
# 显式定向,避免 Expo CLI 在多台已开机 simulator 中打开错误设备。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
用法:
  bash scripts/dev-ios.sh --go          # Expo Go
  bash scripts/dev-ios.sh --devbuild    # development build

通过 pnpm:
  pnpm dev:ios -- --go
  pnpm dev:ios -- --devbuild
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

# development 启动只使用一台机器级共享 simulator。E2E 仍使用
# scripts/lib/worktree-dev-env.sh 提供的 worktree 专属 simulator。
IOS_SIMULATOR_NAME="incipel-development"
IOS_DEVICE_TYPE="${IOS_DEVICE_TYPE:-iPhone 16 Pro}"
APP_SCHEME="${APP_SCHEME:-incipel}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-com.incipel.app}"
EXPO_GO_BUNDLE_ID="host.exp.Exponent"

# 确保 xcrun 能找到 simctl:若 xcode-select 当前指向 Command Line Tools(不含 simctl)、
# 但系统装了完整 Xcode,则回退到 Xcode 的 DEVELOPER_DIR,免去 sudo xcode-select -s。
if ! xcrun simctl help >/dev/null 2>&1; then
  for d in /Applications/Xcode.app/Contents/Developer /Applications/Xcode-beta.app/Contents/Developer; do
    if [ -d "$d" ] && DEVELOPER_DIR="$d" xcrun simctl help >/dev/null 2>&1; then
      export DEVELOPER_DIR="$d"; break
    fi
  done
fi
if ! xcrun simctl help >/dev/null 2>&1; then
  echo "✗ 找不到 iOS 模拟器工具 simctl。请安装 Xcode,并执行:sudo xcode-select -s /Applications/Xcode.app"
  exit 1
fi

udid_for_name() {
  xcrun simctl list devices 2>/dev/null \
    | grep -F "$1 (" \
    | grep -oE '[0-9A-Fa-f-]{36}' \
    | head -1
}

prepare_ios_devbuild_project() {
  ( cd "$REPO_ROOT/apps/mobile" && npx expo prebuild --platform ios )

  podfile="$REPO_ROOT/apps/mobile/ios/Podfile"
  if [ ! -f "$podfile" ]; then
    echo "✗ expo prebuild 未生成 ios/Podfile。"
    exit 1
  fi
  ( cd "$REPO_ROOT/apps/mobile/ios" && pod install )
}

build_and_install_ios_devbuild() {
  prepare_ios_devbuild_project
  ios_build_dir="$REPO_ROOT/apps/mobile/ios/build"
  ios_app_path="$ios_build_dir/Build/Products/Debug-iphonesimulator/app.app"
  xcodebuild \
    -workspace "$REPO_ROOT/apps/mobile/ios/app.xcworkspace" \
    -scheme app \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath "$ios_build_dir" \
    CODE_SIGN_IDENTITY="-" \
    build
  if [ ! -d "$ios_app_path" ]; then
    echo "✗ Xcode build 未生成 $ios_app_path。"
    exit 1
  fi
  xcrun simctl install "$UDID" "$ios_app_path"
}

echo "▸ worktree     : $REPO_ROOT"
echo "▸ Metro 端口   : $EXPO_PORT"
echo "▸ Agent        : Mastra Node server(本脚本会自动起共用 Supabase 栈并后台启动 agent)"
echo "▸ iOS 模拟器   : $IOS_SIMULATOR_NAME"

UDID="$(udid_for_name "$IOS_SIMULATOR_NAME" || true)"
if [ -z "$UDID" ]; then
  echo "▸ 模拟器不存在,正在创建(机型: $IOS_DEVICE_TYPE)…"
  UDID="$(xcrun simctl create "$IOS_SIMULATOR_NAME" "$IOS_DEVICE_TYPE" 2>/dev/null || true)"
  if [ -z "$UDID" ]; then
    # 默认机型不可用:自动挑一个本机可用的 iPhone 机型
    alt="$(xcrun simctl list devicetypes 2>/dev/null | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone[^ )]*' | tail -1)"
    if [ -n "$alt" ]; then
      echo "  机型 \"$IOS_DEVICE_TYPE\" 不可用,改用 $alt"
      UDID="$(xcrun simctl create "$IOS_SIMULATOR_NAME" "$alt" 2>/dev/null || true)"
    fi
  fi
  if [ -z "$UDID" ]; then
    echo "✗ 创建模拟器失败。可用 iPhone 机型:"
    xcrun simctl list devicetypes | grep -i iphone || true
    echo "  可设 IOS_DEVICE_TYPE 后重试,例如:IOS_DEVICE_TYPE='iPhone 15' bash scripts/dev-ios.sh"
    exit 1
  fi
fi
echo "▸ UDID         : $UDID"

echo "▸ 启动模拟器…"
xcrun simctl boot "$UDID" 2>/dev/null || true   # 已开机则忽略
open -a Simulator >/dev/null 2>&1 || true

if [ "$DEVBUILD" -eq 1 ] && ! xcrun simctl get_app_container "$UDID" "$IOS_BUNDLE_ID" >/dev/null 2>&1; then
  echo ""
  echo "▸ 该模拟器尚未安装 development build($IOS_BUNDLE_ID),正在构建并安装…"
  build_and_install_ios_devbuild
  echo "✓ development build 已安装到 \"$IOS_SIMULATOR_NAME\""
fi

# 起共用 Supabase 栈 + 后台启动 agent server(已在跑则自动跳过)。
# 设 INCIPEL_SKIP_AGENT=1 可跳过(例如你在另一个终端用 `pnpm dev:agent` 前台跑 agent)。
if [ "${INCIPEL_SKIP_AGENT:-0}" != "1" ]; then
  node "$REPO_ROOT/tools/incipel-dev/cli.mjs" up
fi

cd "$REPO_ROOT/apps/mobile"

# 后台等待 Metro 就绪,再把这台模拟器定向到本 worktree 的端口
(
  url="exp://127.0.0.1:$EXPO_PORT"
  [ "$DEVBUILD" -eq 1 ] && url="$APP_SCHEME://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$EXPO_PORT"
  for _ in $(seq 1 90); do
    if curl -sf "http://127.0.0.1:$EXPO_PORT/status" >/dev/null 2>&1; then
      if [ "$DEVBUILD" -eq 0 ] && ! xcrun simctl get_app_container "$UDID" "$EXPO_GO_BUNDLE_ID" >/dev/null 2>&1; then
        echo ""
        echo "ℹ 该模拟器尚未安装 Expo Go。首次请在下方 Metro 菜单按 shift+i 选 \"$IOS_SIMULATOR_NAME\" 安装,"
        echo "  之后再次运行本脚本即可自动定向到这台模拟器。"
        exit 0
      fi
      if xcrun simctl openurl "$UDID" "$url" >/dev/null 2>&1; then
        echo "✓ 已在模拟器 \"$IOS_SIMULATOR_NAME\" 打开 $url"
      else
        echo "ℹ 自动打开失败,可在 Metro 菜单按 shift+i 选 \"$IOS_SIMULATOR_NAME\"。"
      fi
      exit 0
    fi
    sleep 1
  done
) &

if [ "$DEVBUILD" -eq 1 ]; then
  exec npx expo start --port "$EXPO_PORT" --dev-client
else
  exec npx expo start --port "$EXPO_PORT" --go
fi
