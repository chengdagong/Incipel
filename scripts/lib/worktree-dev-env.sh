#!/usr/bin/env bash
# 被 scripts/dev-ios.sh / scripts/dev-android.sh 通过 `source` 引入。
#
# 职责:确定「本 worktree」的开发隔离参数(Metro 端口 / E2E iOS simulator 名 / Android serial),
# 持久化到本 worktree 根目录的 .worktree-dev.env(已被 .gitignore 忽略,每个 worktree 各持一份)。
#   - EXPO_PORT          : Metro 端口,固定 8081(我们总是只跑一个 dev 环境,不再 per-worktree 错开)
#   - IOS_SIMULATOR_NAME : pnpm e2e:ios 使用的本 worktree 专属 iOS simulator 名;由分支名派生
#   - ANDROID_SERIAL     : Android 目标 serial;留空交由 dev-android.sh 自动判定
#
# 写 apps/mobile/.env 与 supabase/.env、起共用栈、serve agent edge function,统一交给
# `node tools/incipel-dev/cli.mjs up`(dev:ios / dev:android 会在起 Metro 前调它);本文件不碰 .env。
# agent 已无 per-worktree 端口(它是共用栈上的 edge function,见 docs/adr/0007)。
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

# 1.5) 新 worktree 开箱即跑:apps/mobile 缺 expo(缺它 Metro 起不来、报 ConfigError)就先装一次。
#      pnpm 用全局内容寻址 store,命中时只是几秒硬链接、不重复下载,故每个 worktree 装一次很轻——
#      不需要、也无法靠「全局装 expo」省掉(RN/Metro 是项目本地解析,expo 是 app import 的库)。
#      用 expo 作探针;失败(网络等)会因 set -e 中止,不会带着半套依赖去起 Metro。
if [ ! -d "$REPO_ROOT/apps/mobile/node_modules/expo" ]; then
  echo "▸ apps/mobile 缺依赖,先 pnpm install(pnpm store 命中通常几秒)…"
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

# 4) 写回:持久化本 worktree 选定的设备项(EXPO_PORT 是常量,不入文件)。
cat > "$ENV_FILE" <<EOF
# 本 worktree 的开发隔离配置(由 scripts/lib/worktree-dev-env.sh 自动生成,可手改)。
# 该文件已被 .gitignore 忽略,每个 worktree 各持一份。说明见 docs/worktree-dev.md。
IOS_SIMULATOR_NAME="$IOS_SIMULATOR_NAME"
# 留空则 dev-android.sh 在仅一台 emulator 在线时自动选用;多台在线时请填 adb serial(如 emulator-5556)。
ANDROID_SERIAL="$ANDROID_SERIAL"
EOF

export REPO_ROOT ENV_FILE EXPO_PORT IOS_SIMULATOR_NAME ANDROID_SERIAL
