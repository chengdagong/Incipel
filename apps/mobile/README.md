# @incipel/mobile — 本地运行说明

编剧助手「织幕」的 React Native / Expo 客户端。整体设计见仓库根 [`docs/system-design.md`](../../docs/system-design.md)、术语见 [`CONTEXT.md`](../../CONTEXT.md)。

## 前置

- Node ≥ 20、pnpm
- 完整 Xcode(不是只装 Command Line Tools)+ 一个 iOS 模拟器
- 仓库根已 `pnpm install`

> 若 `xcode-select -p` 指向 `CommandLineTools`,`simctl` 看不到模拟器。无需 sudo 改全局,跑 expo 时带 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` 即可。

## 环境变量

复制 `.env.example` 为 `.env`(已被 gitignore):

```
EXPO_PUBLIC_AGENT_URL=http://127.0.0.1:54521/functions/v1/agent   # agent 是共用栈上的 edge function(见 ADR-0007)
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521
EXPO_PUBLIC_SUPABASE_ANON_KEY=<本地 Supabase anon key>
```

只放公开的 anon key 与 agent URL,**绝不放模型密钥**(模型只在 agent 端调用)。`pnpm dev:ios` / `dev:android` 会自动把 `EXPO_PUBLIC_AGENT_URL` 写好。iOS 模拟器与 `localhost` 直通;Android 模拟器经 `dev-android.sh` 的 `adb reverse` 也走 `localhost`;真机则把 `127.0.0.1` 换成本机局域网 IP。

## 启动

先起 agent(`pnpm dev:agent` —— 起共用 Supabase 栈 + serve agent edge function),再起本客户端。
推荐用 worktree 感知脚本 `pnpm dev:ios`(Metro 固定 8081、定向到本 worktree 的模拟器);或手动:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @incipel/mobile exec expo start --ios
```

去掉 `CI=1`(若设过)可开热重载。app 加载后:输入灵感 → 开始创作 → 在对话里流式创作。

## 本地开发登录路径

日常开发默认走 Supabase anonymous auth:登录页显示后点击「先随便逛逛」,客户端调用 `signInAnonymously()` 取得 session,agent 用该 JWT 校验身份并把会话数据保存到本地 Supabase 数据库。`pnpm dev:ios` / `dev:android` / `dev:agent` 会经 `tools/incipel-dev` 写好 `apps/mobile/.env` 的本地 URL、anon key 与 agent URL。

只试 UI 且不需要保存时,才手动启用跳过身份校验的调试模式。**注意:`pnpm dev:*` / `dx up` / `env:sync` 会从 `supabase/.env` 删掉 `STORE` / `DEV_NO_AUTH` 以强制 anonymous auth(见 ADR-0008),所以别把它们写进 `supabase/.env`**;改用一个**自备** env-file、手动跑 serve(绕开 dev 脚本):

```bash
# debug.env(自备,别交给 dev 脚本管理)
MODEL_PROVIDER=openrouter
STORE=memory        # 进程级内存 store,免 Supabase schema(重启即丢)
DEV_NO_AUTH=1       # 跳过 JWT 校验,用固定 dev 用户
# 跑:supabase functions serve agent --env-file debug.env --no-verify-jwt
```

客户端侧再在 `apps/mobile/.env` 设 `EXPO_PUBLIC_DEV_NO_AUTH=1`:登录页是入口(见 [ADR-0005](../../docs/adr/0005-auth-entry-in-v1.md)),不设它则没有 Supabase 会话,无法进入创作页。**这些 DEV 开关仅用于本地调试,prod 绝不开。**

## 这套依赖在 RN/Expo 下踩过的坑(都已修进本包,改动时勿回退)

| 现象 | 修法 |
|---|---|
| `Unable to resolve @babel/runtime/helpers/...` | 直接依赖 `@babel/runtime`(钉 7.x,勿用 8.x) |
| `Route "./_layout.tsx" missing default export` / 路由报错 | 补 expo-router peer:`react-native-safe-area-context`、`expo-constants`、`expo-linking` |
| `Unable to resolve @bufbuild/protobuf/wire`(@ag-ui/proto 依赖) | `metro.config.js` 对 `@bufbuild/protobuf/<sub>` 做精确别名指向 `dist/cjs/<sub>/index.js`(不要全局开 `unstable_enablePackageExports`,实测会引入运行时 `Requiring unknown module undefined`) |
| `crypto.getRandomValues() not supported`(uuid) | `react-native-get-random-values`,在 `app/_layout.tsx` 最顶部 import |
| 引用 `ReadableStream` 时 `Requiring unknown module undefined` | web-streams-polyfill 改 import 自包含的 `dist/polyfill.es5.js`(命名导入主入口在 Metro 下会解析成 undefined) |
| `Failed to getReader() from response`(读 SSE 流) | HttpAgent 改用 `expo/fetch`(RN 全局 fetch 的 response.body 不支持流式 `getReader()`) |

定位这些大多靠截模拟器红屏看真实堆栈:`xcrun simctl io booted screenshot out.png`。
