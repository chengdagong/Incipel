# Google 登录支持设计

> 日期: 2026-06-22
> 状态: 已确认设计,待实现计划
> 范围: iOS / Android 原生 app 的 Google 登录与匿名账号绑定

## 背景

当前登录入口由 ADR-0005 定义:登录页是无会话时的入口,Apple Sign-In 与匿名登录是真实入口,Google 与邮箱先显示为“即将开放”。现在需要把 Google 登录接入 v1。

本设计采用 native Google Sign-In + Supabase Auth。Google 不走浏览器 OAuth redirect;它与现有 Apple 登录保持同类行为:先由原生 provider 取得第三方 `identity token`,再交给 Supabase Auth 换取 Supabase session。

## 目标

- 登录页的“通过 Google 登录”成为 iOS / Android 可用入口。
- 匿名用户可以在设置页绑定 Google,并保留同一个 Supabase user id 下已有的会话和作品。
- Google 与 Apple 的代码完全分开,不引入 `signInWithProvider(provider)` 这类抽象。
- Agent、JWT 校验、Postgres RLS、会话与作品数据模型保持不变。
- 后台配置和人工验证步骤写成文档,与现有 Apple 配置说明同级。

## 不纳入范围

- 不做已有 Google 账号与当前匿名账号的作品迁移。
- 不做多个账号之间的作品合并。
- 不做 Google 解绑。
- 不保存 Google access token 用于调用 Google API。
- 不接邮箱登录,邮箱入口仍显示“即将开放”。
- 不把 web 预览作为本次验收平台。

## 决定

采用 native Google Sign-In + Supabase `signInWithIdToken` / native identity linking。

无会话登录时:

```ts
supabase.auth.signInWithIdToken({
  provider: 'google',
  token: idToken,
  nonce: rawNonce,
});
```

匿名绑定时:

```ts
supabase.auth.linkIdentity({
  provider: 'google',
  token: idToken,
  access_token: accessToken,
});
```

实现前必须确认所选 Google native package 的当前稳定版本与 nonce 支持情况。新增依赖时不得凭记忆写版本号,需要用 `npm view` 或官方资料确认当前 stable 版本。如果所选 package 不能在 iOS / Android 的目标路径中满足 `idToken` 和 nonce 要求,实现计划需要回到设计评审,不能静默省略 nonce。

绑定路径还必须确认 Google native package 能返回 `accessToken`,因为 native `linkIdentity` 需要 `idToken` 与 `accessToken` 一起交给 Supabase。若目标 package 在当前配置下拿不到 `accessToken`,实现计划也需要回到设计评审。

## Architecture

Apple 与 Google 保持独立模块:

- Apple:现有 `expo-apple-authentication` -> Apple `identityToken` -> `supabase.auth.signInWithIdToken({ provider: 'apple' })`。
- Google:新增 Google 独立模块 -> Google `idToken` / `accessToken` -> `supabase.auth.signInWithIdToken({ provider: 'google' })` 或 native `linkIdentity`。

允许共享的部分只限于不含 provider 语义的基础设施:

- `supabase` client;
- `useAuth()` session 状态;
- 路由门控;
- UI 的 busy / error 状态;
- Supabase session 持久化。

不允许的实现:

- 不写 `signInWithProvider(provider)`。
- 不把 Apple 和 Google 放进同一个 provider switch。
- 不让 Google 复用 Apple 的 nonce / credential 处理函数。
- 不把 Google 登录写进 agent 或服务端业务代码。

建议文件边界:

- `apps/mobile/src/google-auth.ts`:Google native Sign-In 配置、nonce、`signInWithGoogle`、`linkGoogleIdentity`、Google 错误分类。
- `apps/mobile/src/supabase.ts`:保留 Supabase client 与 Apple 现有 helper;若迁出 Apple helper,也应迁到 `apple-auth.ts`,不与 Google 混写。
- `apps/mobile/app/login.tsx`:保留 `loginWithApple()`,新增 `loginWithGoogle()`。
- `apps/mobile/app/(app)/settings.tsx`:账号显示改为 provider-aware,匿名用户入口调用 `linkGoogleIdentity()`。

## Data Flow

### 无会话 Google 登录

1. 用户在登录页点“通过 Google 登录”。
2. `loginWithGoogle()` 调用 Google 模块的 `signInWithGoogle()`。
3. Google 模块检查配置,Android 先检查 Google Play Services。
4. Google native Sign-In 返回 `idToken`;如果这是匿名绑定前的预检查,还必须确认同一路径可返回 `accessToken`。
5. Google 模块调用 Supabase `signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce })`。
6. Supabase 返回 session。
7. 现有 `onAuthStateChange` 推送 session。
8. 登录页通过现有 `Redirect` 进入创作页。
9. 后续 agent 请求继续使用 `authHeaders()` 读取 Supabase access token。

### 匿名用户绑定 Google

1. 用户已通过“先随便逛逛”进入 app,`session.user.is_anonymous === true`。
2. 设置页账号区显示匿名状态,入口文案改为“绑定 Google”。
3. `linkGoogleIdentity()` 调用 Google native Sign-In,取得 `idToken` / `accessToken`;任一 token 缺失都视为 Google 登录失败。
4. Google 模块调用 Supabase native identity linking。
5. 绑定成功后仍使用原来的 Supabase user id,已有会话和作品继续属于同一个用户。
6. 设置页重新读取 session 或 identities,显示 Google 已绑定。

### 已有 Google 账号冲突

如果 `linkIdentity` 返回 Google identity 已属于另一个 Supabase user,本次只提示:

> 该 Google 账号已被使用,请换一个 Google 账号,或退出当前匿名会话后再登录。

不会迁移作品,不会切换到另一个用户,不会删除当前匿名会话。

## Error Handling

登录页与设置页沿用现有交互:按钮进入 busy 状态;成功后不手动跳转,等待 `onAuthStateChange` 或页面状态刷新;失败留在当前页并显示可重试提示。

错误分类:

- 用户取消 Google 账号选择:静默留在当前页。
- Google Sign-In 已在进行:忽略重复点击。
- Android Google Play Services 不可用或过旧:提示“当前设备暂不能使用 Google 登录,请更新 Google Play 服务或使用其他入口。”
- Google native 配置缺失,例如 client id、iOS URL scheme、Android SHA-1 不匹配:提示“Google 登录配置未完成,请稍后再试。”并用 `console.warn` 输出原始错误。
- Google 返回但没有 `idToken`:提示“Google 登录失败,请稍后重试。”
- Supabase Google provider 未开启或 client id 不匹配:提示“Google 登录配置未完成,请稍后再试。”
- 匿名绑定时 Google 账号已属于另一个用户:显示冲突提示,不迁移作品。
- 网络错误或 Supabase 临时错误:提示“Google 登录失败,请稍后重试。”

## Provider 展示

设置页不再使用“非匿名 = Apple 用户”的判断。新规则:

- `session.user.is_anonymous === true`:显示匿名状态与“绑定 Google”入口。
- 有 Google identity:显示“Google 用户”或邮箱。
- 有 Apple identity:显示“Apple 用户”或邮箱。
- 非匿名但无法识别 provider:显示“已登录”。

provider 判断优先使用 `getUserIdentities()`;如果读取失败,可以退回 `session.user.app_metadata.provider`,但不能因为读取失败而把 Google 用户显示成 Apple 用户。

## 配置

需要新增 `docs/google-sign-in-setup.md`,写清:

- Google Cloud / Firebase 中的 iOS OAuth client;
- Google Cloud / Firebase 中的 Android OAuth client;
- Android SHA-1 指纹,包括本地 development build、EAS build、日后 Play App Signing;
- Web client id,用于 native SDK 获取 `idToken`;
- iOS reversed client id / URL scheme,通过 Expo config plugin 写入 native project;
- Supabase Dashboard 中开启 Google provider,填写对应 client id / secret;
- 本地 Supabase 配置中打开 `auth.external.google`;
- development build / TestFlight / Android build 的验证步骤。

实现时如果新增 native module,需要通过 Expo config plugin 写入 `app.json`。改动后要重新生成并构建原生工程;Expo Go 不作为验收环境。

## Testing

### 自动化测试

1. TypeScript 单元测试
   给 Google 模块加可注入 native adapter,覆盖:
   - 用户取消;
   - 不返回 `idToken`;
   - Supabase `signInWithIdToken` 失败;
   - `linkIdentity` 冲突;
   - 成功返回 session。

2. 移动端 typecheck
   运行 `pnpm --filter @incipel/mobile typecheck`,确认 native module 类型、Google helper、登录页和设置页调用正确。

3. Maestro E2E
   不跑真实 Google 授权。E2E 只覆盖 UI 状态:
   - Google 按钮可见且不再显示“即将开放”;
   - 邮箱仍显示“即将开放”;
   - `DEV_NO_AUTH` 仍跳过登录页;
   - 匿名入口仍可用;
   - 现有 supabase 层匿名登录、星标、历史续写仍通过。

### 人工验证

- iOS development build 或 TestFlight:点 Google 按钮,能拉起 Google 原生授权,成功后进入创作页。
- Android development build:Google Play Services 正常时能登录;缺失或过旧时显示明确提示。
- 匿名用户绑定 Google 后,原有作品仍在历史列表中。
- 绑定已被其他用户使用的 Google 账号时,显示冲突提示,不切换用户,不迁移作品。
- Supabase Dashboard 未开 Google provider 或 client id 配错时,app 不崩,显示配置未完成提示。
- Apple 登录、匿名登录、登出仍按现有行为工作。

## 文档与 ADR

- 新增 `docs/google-sign-in-setup.md`。
- 更新 ADR-0005 或新增 ADR,记录 Google 从“暂不接”进入 v1 范围。
- ADR 中明确:本次不做账号合并和作品迁移;Google 与 Apple 在代码上分开;二者都通过 Supabase Auth 生成最终 session。

## 参考

- [Supabase Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase signInWithIdToken](https://supabase.com/docs/reference/javascript/auth-signinwithidtoken)
- [Supabase linkIdentity](https://supabase.com/docs/reference/javascript/auth-linkidentity)
- [React Native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [React Native Google Sign-In API](https://react-native-google-signin.github.io/docs/api)
