#!/usr/bin/env bash
# 在「本 worktree 专属」的 iOS 模拟器上,以 release 包(JS 内嵌)为运行目标跑 Maestro E2E。
#
#   bash scripts/e2e-ios.sh                       # 默认跑 frontend-only,stub-agent 两层(免 Supabase)
#   bash scripts/e2e-ios.sh frontend-only         # 只跑无后端的纯 UI 流
#   bash scripts/e2e-ios.sh stub-agent            # 只跑 stub agent 创作主路径
#   bash scripts/e2e-ios.sh supabase              # 跑需真实匿名登录 + 本地 Supabase 的流(需先 supabase start)
#   bash scripts/e2e-ios.sh frontend-only --no-build  # 复用已装的包,只重跑 Maestro(改 flow 时省一次构建)
#
# 三层按后端依赖切(详见 apps/mobile/.maestro/README.md):
#   frontend-only   仅 app(DEV_NO_AUTH bundle),不起 agent
#   stub-agent      app(DEV_NO_AUTH)+ agent(MODEL_PROVIDER=stub STORE=memory DEV_NO_AUTH=1)
#   supabase        app(真实匿名登录,不设 DEV_NO_AUTH)+ agent(MODEL_PROVIDER=stub + 真 SupabaseStore)
#
# 为什么跑 release 包、不跑 dev-client(见 ADR-0007):dev-client 加载 bundle 会弹开发者菜单模态盖住
# 界面、clearState 会清掉它记的 Metro 地址落到 launcher——两处摩擦让 Maestro 到不了欢迎页。release
# 二进制 JS 内嵌、不连 Metro,clearState 求每次干净起步才成立,是 Maestro E2E 的标准目标。
#
# EXPO_PUBLIC_DEV_NO_AUTH 是 bundle 期烘进二进制的,所以两组 bundle 不能同跑:frontend-only+stub-agent
# 开它、supabase 关它并填真 anon key。切层要重新构建(本脚本默认每次构建;--no-build 仅在同一层复跑时用)。
#
# 端口 / 模拟器名由 scripts/lib/worktree-dev-env.sh 按 worktree 分配,互不冲突。
#
# 前置(本脚本会尽量代办,缺时给出提示):
#   - 已装 maestro(curl -fsSL "https://get.maestro.mobile.dev" | bash)与 JDK 17+
#   - 完整 Xcode(用于 xcodebuild / simctl)与 CocoaPods(brew install cocoapods)
#   - 首次会自动 `expo prebuild` 生成 ios/ 原生工程并 `pod install`(之后复用,ios/ 已被 gitignore)
#   - supabase 层另需:`supabase start` 与 `pnpm env:sync`,确保 supabase/.env 填好
#     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INCIPEL_SUPABASE_JWT_SECRET,
#     apps/mobile/.env 填好真实 EXPO_PUBLIC_SUPABASE_ANON_KEY。若使用 `pnpm e2e:stack up`
#     生成的隔离栈,可设 INCIPEL_E2E_AGENT_ENV=.worktree-supabase/agent.env。
set -euo pipefail

# ── 解析参数:第一个非 --flag 当作层(tags);--no-build 跳过构建+安装、直接复用已装包重跑 ──
TIERS=""
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    -*) echo "✗ 未知参数:$arg"; exit 1 ;;
    *) [ -z "$TIERS" ] && TIERS="$arg" ;;
  esac
done
TIERS="${TIERS:-frontend-only,stub-agent}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/worktree-dev-env.sh
. "$SCRIPT_DIR/lib/worktree-dev-env.sh"  # → REPO_ROOT / EXPO_PORT / AGENT_PORT / IOS_SIMULATOR_NAME；
                                         #   导出 set_env_var()

MOBILE_DIR="$REPO_ROOT/apps/mobile"
MOBILE_ENV="$MOBILE_DIR/.env"
AGENT_ENV="${INCIPEL_E2E_AGENT_ENV:-$REPO_ROOT/supabase/.env}"
IOS_DIR="$MOBILE_DIR/ios"
DERIVED="$IOS_DIR/build-release"
IOS_DEVICE_TYPE="${IOS_DEVICE_TYPE:-iPhone 16 Pro}"

# supabase 层要真实会话(DEV_NO_AUTH 必须留空);frontend-only/stub-agent 层要 DEV_NO_AUTH=1。两者 bundle 不同,不能同跑。
if printf '%s' "$TIERS" | grep -q 'supabase' && printf '%s' "$TIERS" | grep -qE 'frontend-only|stub-agent'; then
  echo "✗ supabase 层与 frontend-only/stub-agent 层的 EXPO_PUBLIC_DEV_NO_AUTH bundle 不同,不能同跑。"
  echo "  分两次:bash scripts/e2e-ios.sh frontend-only,stub-agent  与  bash scripts/e2e-ios.sh supabase"
  exit 1
fi

# supabase 层要真实会话(DEV_NO_AUTH 必须留空);frontend-only/stub-agent 层要 DEV_NO_AUTH=1。两者 bundle 不同,不能同跑。
case "$TIERS" in
  *supabase*) WANT_DEV_NO_AUTH="" ;;
  *)          WANT_DEV_NO_AUTH="1" ;;
esac

# supabase 层的 agent 需要显式导出 env-file。Node entrypoint 不读取 dotenv,因此不能只依赖 cwd。
if [ -z "$WANT_DEV_NO_AUTH" ]; then
  [ -f "$AGENT_ENV" ] || {
    echo "✗ supabase 层需有 agent env-file:$AGENT_ENV"
    echo "  共用栈请先运行 pnpm env:sync;隔离栈请先运行 pnpm e2e:stack up,并设置 INCIPEL_E2E_AGENT_ENV。"
    exit 1
  }
  set -a
  # shellcheck disable=SC1090
  . "$AGENT_ENV"
  set +a
fi

# ── 工具链定位(非交互 shell 不读 ~/.zshrc,这里自行接好 PATH / DEVELOPER_DIR)──
# node:Release 的 bundling 阶段(Xcode「Bundle React Native code and images」)会调 node。
for nd in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
  [ -x "$nd/node" ] && case ":$PATH:" in *":$nd:"*) ;; *) PATH="$nd:$PATH" ;; esac
done
# CocoaPods(brew 装的)与 maestro 也补进 PATH。
for bd in /opt/homebrew/bin "$HOME/.maestro/bin"; do
  [ -d "$bd" ] && case ":$PATH:" in *":$bd:"*) ;; *) PATH="$bd:$PATH" ;; esac
done
export PATH

# DEVELOPER_DIR 指向完整 Xcode(xcodebuild + simctl 都需要;xcode-select 可能指向 CommandLineTools)。
if ! xcodebuild -version >/dev/null 2>&1 || ! xcrun simctl help >/dev/null 2>&1; then
  for d in /Applications/Xcode.app/Contents/Developer /Applications/Xcode-beta.app/Contents/Developer; do
    if [ -d "$d" ]; then export DEVELOPER_DIR="$d"; break; fi
  done
fi
xcrun simctl help >/dev/null 2>&1 || { echo "✗ 找不到 simctl。请装 Xcode 并:sudo xcode-select -s /Applications/Xcode.app"; exit 1; }
xcodebuild -version >/dev/null 2>&1 || { echo "✗ 找不到 xcodebuild(需完整 Xcode)。"; exit 1; }

# Maestro 是 JVM 程序,需 JDK。/usr/bin/java 是桩(无真实 JDK 时 `java -version` 退非零),故用「能否真跑」判断。
if [ -z "${JAVA_HOME:-}" ] && ! java -version >/dev/null 2>&1; then
  for j in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17 /opt/homebrew/opt/openjdk /usr/local/opt/openjdk; do
    if [ -x "$j/bin/java" ]; then export JAVA_HOME="$j"; export PATH="$j/bin:$PATH"; break; fi
  done
fi
command -v maestro >/dev/null 2>&1 || { echo "✗ 未找到 maestro。安装:curl -fsSL \"https://get.maestro.mobile.dev\" | bash"; exit 1; }
if { [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; } || java -version >/dev/null 2>&1; then :; else
  echo "✗ 未找到可用的 Java(Maestro 需 JDK 17+)。装:brew install openjdk@21"; exit 1
fi

# ── 找/建本 worktree 专属模拟器(镜像 dev-ios.sh:机型不可用时自动回退)──
udid_for_name() { xcrun simctl list devices 2>/dev/null | grep -F "$1 (" | grep -oE '[0-9A-Fa-f-]{36}' | head -1; }
UDID="$(udid_for_name "${IOS_SIMULATOR_NAME}" || true)"
if [ -z "$UDID" ]; then
  echo "▸ 模拟器「${IOS_SIMULATOR_NAME}」不存在,正在创建(机型: ${IOS_DEVICE_TYPE})…"
  UDID="$(xcrun simctl create "${IOS_SIMULATOR_NAME}" "${IOS_DEVICE_TYPE}" 2>/dev/null || true)"
  if [ -z "$UDID" ]; then
    alt="$(xcrun simctl list devicetypes 2>/dev/null | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone[^ )]*' | tail -1)"
    [ -n "$alt" ] && { echo "  机型 \"${IOS_DEVICE_TYPE}\" 不可用,改用 ${alt}"; UDID="$(xcrun simctl create "${IOS_SIMULATOR_NAME}" "${alt}" 2>/dev/null || true)"; }
  fi
  [ -z "$UDID" ] && { echo "✗ 创建模拟器失败。可设 IOS_DEVICE_TYPE 后重试。"; exit 1; }
fi

echo "▸ worktree   : $REPO_ROOT"
echo "▸ 层 (tags)  : $TIERS"
echo "▸ Agent 端口 : $AGENT_PORT"
if [ -z "$WANT_DEV_NO_AUTH" ]; then
  echo "▸ Agent env  : $AGENT_ENV"
fi
echo "▸ 模拟器     : ${IOS_SIMULATOR_NAME} (${UDID})"

xcrun simctl boot "$UDID" 2>/dev/null || true  # 已开机则忽略
open -a Simulator >/dev/null 2>&1 || true

# ── 清理与 .env 还原(EXPO_PUBLIC_DEV_NO_AUTH 是 bundle 期开关,构建前临时按层改、退出时还原)──
ORIG_DEV_NO_AUTH="$(grep -E '^EXPO_PUBLIC_DEV_NO_AUTH=' "$MOBILE_ENV" 2>/dev/null | head -1 | sed 's/^[^=]*=//' || true)"
ORIG_AGENT_URL="$(grep -E '^EXPO_PUBLIC_AGENT_URL=' "$MOBILE_ENV" 2>/dev/null | head -1 | sed 's/^[^=]*=//' || true)"
AGENT_PID=""
# 按端口收尾 agent:tsx 等会另起子进程,kill 父 PID 未必带走真正监听端口的那个;按端口杀最可靠。
free_port() { # $1 = port
  local pids
  pids="$(lsof -ti tcp:"$1" 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(lsof -ti tcp:"$1" 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
}
cleanup() {
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  free_port "$AGENT_PORT"
  set_env_var "$MOBILE_ENV" EXPO_PUBLIC_DEV_NO_AUTH "$ORIG_DEV_NO_AUTH" >/dev/null 2>&1 || true
  set_env_var "$MOBILE_ENV" EXPO_PUBLIC_AGENT_URL "$ORIG_AGENT_URL" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# supabase 层前置检查:真实 anon key 与 agent 的 Supabase 配置必须就位(本脚本不代填密钥)。
if [ -z "$WANT_DEV_NO_AUTH" ]; then
  anon="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$MOBILE_ENV" 2>/dev/null | head -1 | sed 's/^[^=]*=//' || true)"
  [ -z "$anon" ] && { echo "✗ supabase 层需在 apps/mobile/.env 填真实 EXPO_PUBLIC_SUPABASE_ANON_KEY(supabase status -o env 取)。"; exit 1; }
  for k in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    eval "v=\"\${$k:-}\""
    [ -z "$v" ] && { echo "✗ supabase 层需在 $AGENT_ENV 填 $k(supabase status -o env 取)。"; exit 1; }
  done
  jwt_secret="${INCIPEL_SUPABASE_JWT_SECRET:-${SUPABASE_JWT_SECRET:-}}"
  [ -z "$jwt_secret" ] && { echo "✗ supabase 层需在 $AGENT_ENV 填 INCIPEL_SUPABASE_JWT_SECRET(supabase status -o env 取)。"; exit 1; }
fi

# ── 构建并安装 release 包(除非 --no-build)──
if [ "$NO_BUILD" = 0 ]; then
  set_env_var "$MOBILE_ENV" EXPO_PUBLIC_DEV_NO_AUTH "$WANT_DEV_NO_AUTH" >/dev/null 2>&1 || true
  set_env_var "$MOBILE_ENV" EXPO_PUBLIC_AGENT_URL "http://127.0.0.1:$AGENT_PORT" >/dev/null 2>&1 || true

  # 首次:生成 ios/ 原生工程(--no-install 跳过包管理,随后单独 pod install),再 pod install。
  if ! ls "$IOS_DIR"/*.xcworkspace >/dev/null 2>&1; then
    echo "▸ 生成 iOS 原生工程(expo prebuild,首次较慢)…"
    ( cd "$MOBILE_DIR" && npx expo prebuild --platform ios --no-install )
    echo "▸ pod install…"
    ( cd "$IOS_DIR" && LANG=en_US.UTF-8 pod install )
  fi

  WS="$(ls -d "$IOS_DIR"/*.xcworkspace 2>/dev/null | head -1)"
  [ -z "$WS" ] && { echo "✗ prebuild 后仍未找到 ios/*.xcworkspace"; exit 1; }
  SCHEME="$(basename "$WS" .xcworkspace)"

  # 复用 derivedDataPath 时先删旧 main.jsbundle:否则 Xcode 认 output 最新会跳过 bundling,把旧 .env 的开关烘进去。
  [ -d "$DERIVED" ] && find "$DERIVED" -name 'main.jsbundle' -delete 2>/dev/null || true

  echo "▸ 构建 Release 包(scheme=$SCHEME,JS 内嵌,EXPO_PUBLIC_DEV_NO_AUTH=${WANT_DEV_NO_AUTH:-<空>})…"
  ( cd "$MOBILE_DIR" && xcodebuild -workspace "$WS" -scheme "$SCHEME" \
      -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" CODE_SIGN_IDENTITY="-" )

  APP_PRODUCT="$(find "$DERIVED/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)"
  [ -z "$APP_PRODUCT" ] && { echo "✗ 未找到构建产物 *.app"; exit 1; }
  echo "▸ 安装到模拟器:$(basename "$APP_PRODUCT")"
  xcrun simctl install "$UDID" "$APP_PRODUCT"
else
  echo "▸ --no-build:跳过构建/安装,复用已装的 release 包。"
  echo "  注意:请确保已装包的 bundle 期开关与本层一致(切层需去掉 --no-build 重建)。"
fi

# ── 起 stub agent(stub-agent / supabase 层需要;frontend-only 不起)──
need_agent=0
case "$TIERS" in *stub-agent*|*supabase*) need_agent=1 ;; esac
if [ "$need_agent" = 1 ]; then
  # 先清掉本端口上可能残留的上一轮 agent:tsx 子进程不随父 kill 退出,旧实例若仍答 /health,
  # 本轮会误用「配置不对」的它(如上一层的内存 store 当本层的 SupabaseStore 用)——见 #36 的验证记录。
  free_port "$AGENT_PORT"
  echo "▸ 启动 stub agent(MODEL_PROVIDER=stub)…"
  # 直接跑 tsx(非 watch)。supabase 层已在上方导出 agent env-file;env 显式传的键优先。
  case "$TIERS" in
    *supabase*)
      # 真实持久化 + 真实鉴权:显式清掉 STORE / DEV_NO_AUTH,避免 .env 残留把它退回内存/免鉴权。
      ( cd "$REPO_ROOT/packages/agent" && exec env AGENT_PORT="$AGENT_PORT" PORT="$AGENT_PORT" MODEL_PROVIDER=stub STORE= DEV_NO_AUTH= \
          node_modules/.bin/tsx src/index.ts ) &
      AGENT_PID=$!
      ;;
    *)
      ( cd "$REPO_ROOT/packages/agent" && exec env AGENT_PORT="$AGENT_PORT" PORT="$AGENT_PORT" MODEL_PROVIDER=stub STORE=memory DEV_NO_AUTH=1 \
          node_modules/.bin/tsx src/index.ts ) &
      AGENT_PID=$!
      ;;
  esac
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:$AGENT_PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "http://localhost:$AGENT_PORT/health" >/dev/null 2>&1 \
    || { echo "✗ agent 未在 http://localhost:$AGENT_PORT 就绪"; exit 1; }
fi

# ── 跑 Maestro(release 不需 Metro;锁定到本 worktree 的 UDID,按层 tag 过滤)──
echo "▸ 跑 Maestro(--device $UDID, tags: $TIERS)…"
maestro test --device "$UDID" --include-tags "$TIERS" "$MOBILE_DIR/.maestro/"
