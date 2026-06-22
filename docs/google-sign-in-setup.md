# Google Sign-In 后台前置配置

> 配套 Google 登录实现。客户端使用 native Google Sign-In 取得 Google `idToken`,再用 Supabase Auth 换取 Supabase session;匿名账号绑定使用 Supabase native identity linking。

## 现状与代码路径

- `apps/mobile/src/google-auth.ts`:Google native Sign-In 与 Supabase Auth 交换。
- `apps/mobile/app/login.tsx`:无会话时的 Google 登录入口。
- `apps/mobile/app/(app)/settings.tsx`:匿名账号绑定 Google。
- `apps/mobile/app.json`:Google Sign-In config plugin。里面的 `iosUrlScheme` 现在是占位值,原生构建前必须替换。

Apple 与 Google 的代码路径保持分开。Apple 继续使用 `expo-apple-authentication`;Google 使用 `@react-native-google-signin/google-signin`。

## 三组必需配置

### 1. Google Cloud / Firebase

创建或确认这些 OAuth client:

1. **Web client id**
   - 写入 `apps/mobile/.env`:

     ```env
     EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<你的 Web client id>
     ```

   - 同一个 Web client id 填入 Supabase Google provider 的 Client ID。

2. **iOS client**
   - Bundle ID 必须是 `com.incipel.app`。
   - 把 reversed client id 写入 `apps/mobile/app.json`:

     ```json
     [
       "@react-native-google-signin/google-signin",
       {
         "iosUrlScheme": "<你的 reversed iOS client id>"
       }
     ]
     ```

   - 如需显式配置 iOS client id,可在 `apps/mobile/.env` 设置:

     ```env
     EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<你的 iOS client id>
     ```

3. **Android client**
   - Package name 必须是 `com.incipel.app`。
   - 登记对应构建证书的 SHA-1,至少包括本地 development build 与 EAS build。日后上架 Google Play 时,还要登记 Play App Signing 的 SHA-1。

### 2. Supabase Dashboard

进入 Supabase Dashboard → Authentication → Sign In / Providers → Google:

1. Enable Google provider。
2. Client ID 填 Google Web client id。
3. Client Secret 填 Google Web OAuth client secret。
4. 保存后,用 iOS / Android 原生构建验证。

本实现调用的是 `signInWithIdToken({ provider: 'google' })` 和 native `linkIdentity`。Supabase 会校验 Google `idToken`;客户端会同时提交 Google `accessToken`。如果没有取得 `accessToken`,本次登录或绑定会停止并提示重试,不会继续调用 Supabase。

### 3. 本地 Supabase

`supabase/config.toml` 已打开 Google provider,但 `client_id` 是占位值。本地验证 Google 登录前,把它替换成真实 Web client id:

```toml
[auth.external.google]
enabled = true
client_id = "<你的 Web client id>"
secret = "local-native-id-token-flow-needs-provider-secret"
```

本地原生 `idToken` 路径下,`secret` 只需要是非空值;远端 Supabase Dashboard 必须填真实 Google client secret。

## 构建要求

- Expo Go 不支持该 native module。
- 改完 config plugin 后,需要重新执行 `expo prebuild` 并构建 development build / TestFlight / Android build。
- 本仓库有多 worktree 场景,跑模拟器或 E2E 前仍应走 `pnpm dev:ios` / `pnpm dev:android` / `pnpm e2e:ios` 这类 worktree 感知脚本。

## 验证清单

- iOS development build 或 TestFlight:点“通过 Google 登录”,授权成功后进入创作页。
- Android development build:Google Play Services 正常时能登录。
- Android Google Play Services 不可用或过旧时,显示明确提示。
- 匿名绑定:先点“先随便逛逛”,创建一条作品,到设置页绑定 Google,历史列表中仍能看到原作品。
- 冲突账号:绑定已属于另一个用户的 Google 账号时,显示冲突提示,不切换用户,不迁移作品。
- Supabase Google provider 未开启或 Client ID 配错时,app 不崩,显示配置未完成提示。

## 已知限制

- 本次不做账号合并或作品迁移。
- 本次不做 Google 解绑。
- 本次不保存 Google access token 用于调用 Google API;它只用于本次登录或绑定时交给 Supabase 校验。
- Web 预览不在本次验证范围。
