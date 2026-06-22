# Google 登录采用 native ID token 路径

> Status: accepted

ADR-0005 原定 v1 只做 Apple 与匿名,Google 暂不接。本 ADR 记录 Google 进入 v1 的实现方式。

## 决定

- Google 登录采用 native Google Sign-In,由客户端取得 Google `idToken`,再调用 Supabase `signInWithIdToken({ provider: 'google' })`。
- 匿名账号绑定 Google 使用 Supabase native identity linking,传入 Google `idToken` 与 `accessToken`。
- Apple 与 Google 的代码保持独立模块,不写 provider switch 抽象。
- 不做账号合并和作品迁移。Google 账号已属于其他 Supabase user 时,只提示并停止。

## 说明

当前使用的 `@react-native-google-signin/google-signin` Original API 不提供 nonce 参数。本实现不会为 Google 传 nonce;Supabase Google provider 需开启 Skip nonce check。Apple 登录仍保留现有 nonce 校验。

Google `idToken` 可能包含 `at_hash`;因此客户端在 Google 登录和绑定时都会取得 `accessToken`,并把它交给 Supabase 校验。若没有取得 `accessToken`,本次登录或绑定会停止并提示重试。

## 理由

- 这与当前 Apple 登录的机制相近:原生 provider 取得 identity token,Supabase Auth 生成最终 session。
- Supabase user id 仍是业务数据归属的唯一主键,agent、JWT 校验、RLS 和作品数据模型不需要改。
- Google 与 Apple 的后台配置、错误类型和验证方式不同,分开实现更清楚。

## 后果

- 需要 native dependency 与 Expo config plugin,Expo Go 不作为验收环境。
- 需要 Google Cloud / Firebase、Supabase Dashboard 和本地 Supabase 配置。
- Web 预览不在本次范围。
