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
EXPO_PUBLIC_AGENT_URL=http://localhost:8787    # iOS 模拟器用 localhost;Android 模拟器用 10.0.2.2;真机用本机局域网 IP
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521
EXPO_PUBLIC_SUPABASE_ANON_KEY=<本地 Supabase anon key>
```

只放公开的 anon key 与 agent URL,**绝不放模型密钥**(模型只在 agent 端调用)。

## 启动

先起 agent(见 `packages/agent`),再起本客户端:

```bash
# iOS 模拟器(localhost 可达 agent)
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @incipel/mobile exec expo start --ios
```

去掉 `CI=1`(若设过)可开热重载。app 加载后:输入灵感 → 开始创作 → 在对话里流式创作。

## 本地试用(dev)模式

为在模拟器里快速试对话、不依赖云端 Supabase,agent 侧用:

```
MODEL_PROVIDER=openrouter
STORE=memory        # 进程级内存 store,免 Supabase schema(重启即丢)
DEV_NO_AUTH=1       # 跳过 Supabase JWT 校验,用固定 dev 用户
```

因此客户端的 Supabase 匿名登录失败(如本地栈未开匿名登录)不影响对话——会被 `_layout` 的 `.catch` 吞掉。**这些 DEV 开关仅本地用,prod 绝不开。**

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
