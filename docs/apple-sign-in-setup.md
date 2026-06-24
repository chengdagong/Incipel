# Apple Sign-In 后台前置配置(交付说明)

> 配套 issue #10。客户端代码已写完(见
> [`apps/mobile/src/supabase.ts`](../apps/mobile/src/supabase.ts) 的 `signInWithApple`、
> [`apps/mobile/app/login.tsx`](../apps/mobile/app/login.tsx) 的 Apple 按钮),决策依据见
> [ADR-0005](adr/0005-auth-entry-in-v1.md)。要让 Apple 登录真正跑通,还需三步**人工**后台配置;
> 本文逐条写清。

## 现状与降级行为

- `app.json` 已加 `expo-apple-authentication` 插件并设 `ios.usesAppleSignIn: true`,依赖已在
  `package.json`。
- 后台未配置时:Apple 按钮在 iOS 上**可见**,但点了换不到会话——`signInWithIdToken` 返回 error,
  登录页给出「登录失败,请重试。」。app 不崩,「先随便逛逛」匿名入口照常可用。其它入口不受影响。
- 客户端走的是 **iOS 原生** Sign in with Apple:拿设备签发的 identity token,经
  `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })` 换 Supabase 会话。
  下面的配置以这条原生路径为准;web / Android 的 OAuth 路径另见「日后扩展」。

## 三步配置

### 1. Apple Developer:给 App ID 开 Sign in with Apple capability

1. 登录 [developer.apple.com](https://developer.apple.com) →
   Certificates, Identifiers & Profiles → **Identifiers**。
2. 找到或新建 App ID,Bundle ID 填 **`com.incipel.app`**(必须与
   [`app.json`](../apps/mobile/app.json) 的 `ios.bundleIdentifier` 一致)。
3. 在 Capabilities 列表勾选 **Sign In with Apple**,保存。

原生 iOS 登录到这步就够。**不需要** Service ID,也**不需要** Sign in with Apple 私钥(`.p8`)——
那两样只有 web / Android 的 OAuth 路径才用到(见「日后扩展」)。issue 正文「建 Service ID + key」
说的是通用 OAuth 配法;本项目 v1 只接 iOS 原生,故从简。

### 2. Supabase 后台:开 Apple provider,登记 Bundle ID

1. 进 Supabase Dashboard → 目标项目 → Authentication → **Sign In / Providers** → **Apple**。
2. 打开 **Enable Sign in with Apple**。
3. 在 **Client IDs** 填 **`com.incipel.app`**(多个 App ID 用逗号分隔)。Supabase 用它校验
   identity token 的 `aud` 声明,确认该 token 确为本应用所签。
4. 原生路径下,**Secret Key / Services ID / Team ID 留空**即可。保存。

> 这是与 issue 正文措辞的差别:原生 iOS 用 `signInWithIdToken` 时,Supabase 侧的关键是
> Client IDs 里登记 Bundle ID,而非填 Service ID + key。

### 3. 真机 / TestFlight 验证

1. 模拟器对 Sign in with Apple 支持有限(要求登录 iCloud、受信设备),**以真机或 TestFlight 为准**。
2. 把 dev build 装到真机 → 登录页点 Apple 按钮 → 拉起系统原生授权面板 → 用 Apple ID 授权。
3. 预期:授权成功后自动进创作页(session 经 `onAuthStateChange` 推达,登录页的 `Redirect` 接手)。

## 验证清单(对应 issue #10 验收项)

- [ ] `expo-apple-authentication` 在依赖与 `app.json` 插件里 —— 已就位(代码侧)。
- [ ] iOS 点 Apple 按钮拉起原生登录,成功后换到 Supabase 会话并进创作页 —— 配齐三步后真机验证。
- [ ] 取消静默留页(`ERR_REQUEST_CANCELED` 不报错);失败给页内「登录失败,请重试。」—— 代码已实现。
- [ ] 后台未配置时 app 不崩、匿名入口照常可用 —— 代码已实现(`signInWithIdToken` 失败仅抛 error)。
- [ ] 「前置配置」三步已记入交付说明 —— 本文。

## 日后扩展到 web / Android(OAuth 路径,暂不做)

ADR-0005 把 Google / 邮箱与非 iOS 平台的第三方登录推迟。日后在 web 或 Android 接 Apple 登录时,
才需要完整 OAuth 配置:

1. Apple Developer 建 **Services ID**(web 用的标识)与 **Sign in with Apple Key**(`.p8` 私钥,
   配 Key ID、Team ID)。
2. Supabase Apple provider 填 **Services ID** 与据私钥生成的 **Secret Key**,并配回调地址。

届时另开 issue,本文不展开。

## 已知限制

- **未保存用户姓名。** Apple 只在**首次**登录返回用户姓名,且 identity token 本身不含姓名;当前
  `signInWithApple` 请求了 `FULL_NAME` scope 但未持久化 `credential.fullName`。v1 没有展示用户名的
  需求,故暂不处理;日后若要,需在 `signInWithApple` 捕获 `credential.fullName` 并经
  `supabase.auth.updateUser` 写入,且只能赶在用户首次登录那一次(见 `supabase.ts` 内注释)。
