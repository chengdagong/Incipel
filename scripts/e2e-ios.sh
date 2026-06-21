#!/usr/bin/env bash
# 在「本 worktree 专属」的 iOS 模拟器 + 端口上跑 Maestro E2E。
#
#   bash scripts/e2e-ios.sh                # 默认跑 offline,fake 两层(免 Supabase)
#   bash scripts/e2e-ios.sh offline        # 只跑无后端的纯 UI 流
#   bash scripts/e2e-ios.sh fake           # 只跑 fake agent 创作主路径
#   bash scripts/e2e-ios.sh supabase       # 跑需真实匿名登录 + Supabase 的流(需先 supabase start)
#
# 三层按后端依赖切(详见 apps/mobile/.maestro/README.md):
#   offline   仅 app(DEV_NO_AUTH bundle),不起 agent
#   fake      app(DEV_NO_AUTH)+ agent(MODEL_PROVIDER=fake STORE=memory DEV_NO_AUTH=1)
#   supabase  app(真实匿名登录,不设 DEV_NO_AUTH)+ agent(MODEL_PROVIDER=fake + 真 SupabaseStore)
#
# 端口 / 模拟器由 scripts/lib/worktree-dev-env.sh 分配,定向逻辑镜像 scripts/dev-ios.sh
# (按 UDID 用 simctl openurl 把「那台」模拟器指到本 worktree 的 Metro 端口,避免打错设备/旧 bundle)。
#
# 前置(本脚本不代办):
#   - 已装 maestro(curl -fsSL "https://get.maestro.mobile.dev" | bash)
#   - dev build 已装到本 worktree 模拟器:先跑过一次 `pnpm dev:ios --dev-client`(它会建模拟器 + expo run:ios)
#   - supabase 层另需:`supabase start`,且 packages/agent/.env 填好 SUPABASE_URL / SERVICE_ROLE_KEY /
#     JWT_SECRET,apps/mobile/.env 填好真实 EXPO_PUBLIC_SUPABASE_ANON_KEY。
set -euo pipefail

TIERS="${1:-offline,fake}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/worktree-dev-env.sh
. "$SCRIPT_DIR/lib/worktree-dev-env.sh"  # → REPO_ROOT / EXPO_PORT / AGENT_PORT / IOS_SIMULATOR_NAME；
                                         #   写好 apps/mobile/.env 的 EXPO_PUBLIC_AGENT_URL；导出 set_env_var()

MOBILE_ENV="$REPO_ROOT/apps/mobile/.env"
APP_SCHEME="${APP_SCHEME:-incipel}"

# supabase 层要真实会话(DEV_NO_AUTH 必须留空);offline/fake 层要 DEV_NO_AUTH=1。两者 bundle 不同,不能同跑。
if printf '%s' "$TIERS" | grep -q 'supabase' && printf '%s' "$TIERS" | grep -qE 'offline|fake'; then
  echo "✗ supabase 层与 offline/fake 层的 EXPO_PUBLIC_DEV_NO_AUTH bundle 不同,不能同跑。"
  echo "  分两次:bash scripts/e2e-ios.sh offline,fake  与  bash scripts/e2e-ios.sh supabase"
  exit 1
fi

# 定位 maestro 与 java,让 pnpm e2e:ios 不依赖交互式 shell 的 PATH(非交互 shell 不读 ~/.zshrc)。
if ! command -v maestro >/dev/null 2>&1 && [ -x "$HOME/.maestro/bin/maestro" ]; then
  export PATH="$HOME/.maestro/bin:$PATH"
fi
# Maestro 是 JVM 程序,需 JDK。注意:macOS 自带 /usr/bin/java 是「桩」——无真实 JDK 时它仍在
# PATH 上(command -v java 为真)但 `java -version` 退非零,故这里用「java -version 是否真能跑」判断。
if [ -z "${JAVA_HOME:-}" ] && ! java -version >/dev/null 2>&1; then
  for j in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17 /opt/homebrew/opt/openjdk /usr/local/opt/openjdk; do
    if [ -x "$j/bin/java" ]; then export JAVA_HOME="$j"; export PATH="$j/bin:$PATH"; break; fi
  done
fi
command -v maestro >/dev/null 2>&1 || {
  echo "✗ 未找到 maestro。安装:curl -fsSL \"https://get.maestro.mobile.dev\" | bash"
  exit 1
}
# 最终校验:JAVA_HOME 指向可用 JDK(maestro 启动器优先用它),或 PATH 上有能跑的 java。
if { [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; } || java -version >/dev/null 2>&1; then :; else
  echo "✗ 未找到可用的 Java(Maestro 需 JDK 17+)。装:brew install openjdk@21"
  exit 1
fi

# ── simctl 可用性(镜像 dev-ios.sh:xcode-select 指向 CommandLineTools 时回退到完整 Xcode)──
if ! xcrun simctl help >/dev/null 2>&1; then
  for d in /Applications/Xcode.app/Contents/Developer /Applications/Xcode-beta.app/Contents/Developer; do
    if [ -d "$d" ] && DEVELOPER_DIR="$d" xcrun simctl help >/dev/null 2>&1; then export DEVELOPER_DIR="$d"; break; fi
  done
fi
xcrun simctl help >/dev/null 2>&1 || {
  echo "✗ 找不到 iOS 模拟器工具 simctl。请装 Xcode 并:sudo xcode-select -s /Applications/Xcode.app"
  exit 1
}

udid_for_name() {
  xcrun simctl list devices 2>/dev/null | grep -F "$1 (" | grep -oE '[0-9A-Fa-f-]{36}' | head -1
}
UDID="$(udid_for_name "$IOS_SIMULATOR_NAME" || true)"
if [ -z "$UDID" ]; then
  echo "✗ 找不到本 worktree 模拟器「$IOS_SIMULATOR_NAME」。"
  echo "  先跑一次 'pnpm dev:ios --dev-client' 建模拟器并装好 dev build,再回来跑本脚本。"
  exit 1
fi

echo "▸ worktree   : $REPO_ROOT"
echo "▸ 层 (tags)  : $TIERS"
echo "▸ Metro 端口 : $EXPO_PORT"
echo "▸ Agent 端口 : $AGENT_PORT"
echo "▸ 模拟器     : $IOS_SIMULATOR_NAME ($UDID)"

xcrun simctl boot "$UDID" 2>/dev/null || true  # 已开机则忽略
open -a Simulator >/dev/null 2>&1 || true

# ── 清理与 .env 还原(EXPO_PUBLIC_DEV_NO_AUTH 是 bundle 期开关,跑前临时改、跑后还原)──
ORIG_DEV_NO_AUTH="$(grep -E '^EXPO_PUBLIC_DEV_NO_AUTH=' "$MOBILE_ENV" 2>/dev/null | head -1 | sed 's/^[^=]*=//' || true)"
AGENT_PID=""
METRO_PID=""
cleanup() {
  [ -n "$METRO_PID" ] && kill "$METRO_PID" 2>/dev/null || true
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  # 还原 .env 的 DEV_NO_AUTH 到跑前的值(set_env_var 由 worktree-dev-env.sh 提供)。
  set_env_var "$MOBILE_ENV" EXPO_PUBLIC_DEV_NO_AUTH "$ORIG_DEV_NO_AUTH" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# ── 按层设置 app 端 DEV_NO_AUTH(必须在起 Metro 前写好,EXPO_PUBLIC_* 在 bundle 期读取)──
case "$TIERS" in
  *supabase*) set_env_var "$MOBILE_ENV" EXPO_PUBLIC_DEV_NO_AUTH "" >/dev/null 2>&1 || true ;;
  *)          set_env_var "$MOBILE_ENV" EXPO_PUBLIC_DEV_NO_AUTH "1" >/dev/null 2>&1 || true ;;
esac

# ── 起 fake agent(fake / supabase 层需要;offline 不起)──
need_agent=0
case "$TIERS" in *fake*|*supabase*) need_agent=1 ;; esac
if [ "$need_agent" = 1 ]; then
  echo "▸ 启动 fake agent(MODEL_PROVIDER=fake)…"
  case "$TIERS" in
    *supabase*)
      # 真实持久化 + 真实鉴权:显式清掉 STORE / DEV_NO_AUTH,避免 .env 残留把它退回内存/免鉴权。
      ( cd "$REPO_ROOT" && env PORT="$AGENT_PORT" MODEL_PROVIDER=fake STORE= DEV_NO_AUTH= \
          pnpm --filter @incipel/agent dev ) &
      AGENT_PID=$!
      ;;
    *)
      ( cd "$REPO_ROOT" && env PORT="$AGENT_PORT" MODEL_PROVIDER=fake STORE=memory DEV_NO_AUTH=1 \
          pnpm --filter @incipel/agent dev ) &
      AGENT_PID=$!
      ;;
  esac
  # 等 /health 就绪
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:$AGENT_PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "http://localhost:$AGENT_PORT/health" >/dev/null 2>&1 \
    || { echo "✗ agent 未在 http://localhost:$AGENT_PORT 就绪"; exit 1; }
fi

# ── 起 Metro(dev-client),并把本 worktree 模拟器定向到这个端口的 bundle ──
echo "▸ 启动 Metro(dev-client,端口 $EXPO_PORT)…"
( cd "$REPO_ROOT/apps/mobile" && exec npx expo start --port "$EXPO_PORT" --dev-client ) &
METRO_PID=$!
for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$EXPO_PORT/status" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:$EXPO_PORT/status" >/dev/null 2>&1 \
  || { echo "✗ Metro 未在 127.0.0.1:$EXPO_PORT 就绪"; exit 1; }

# 用 UDID 显式把「那台」模拟器指到本 worktree 的 dev-client bundle(镜像 dev-ios.sh)。
DC_URL="$APP_SCHEME://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$EXPO_PORT"
xcrun simctl openurl "$UDID" "$DC_URL" >/dev/null 2>&1 \
  || echo "ℹ 自动 openurl 失败,可在 Metro 菜单按 shift+i 选「$IOS_SIMULATOR_NAME」。"
sleep 3  # 给 JS bundle 一点加载时间(各 flow 的 launchApp 还会再等)

# ── 跑 Maestro,锁定到本 worktree 的 UDID,按层 tag 过滤 ──
echo "▸ 跑 Maestro(--device $UDID, tags: $TIERS)…"
maestro test --device "$UDID" --include-tags "$TIERS" "$REPO_ROOT/apps/mobile/.maestro/"
