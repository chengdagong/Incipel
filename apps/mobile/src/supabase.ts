// Supabase 客户端:用 AsyncStorage 持久化会话(JWT)。
// 客户端只持有匿名 anon key,绝不持有 service key 或任何模型密钥(见 system-design §4)。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // 在开发期尽早暴露缺失的环境变量,避免后续匿名请求静默 401。
  console.warn(
    '[supabase] 缺少 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY,请参照 .env.example 配置。',
  );
}

// 缺环境变量时退回本地默认地址(supabase start 的默认端口),保证 createClient 不在模块加载期抛
// 「supabaseUrl is required」而把整个 app 拦在启动前 —— 后续请求会失败,但不会卡在启动:启动只读
// 会话(getExistingSession 返回 null),失败的匿名登录由登录页给出明确重试提示。
//(本地试用走 agent 的 DEV_NO_AUTH,不依赖 Supabase)。环境变量存在时一律以其为准,不受影响。
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL || 'http://localhost:54321',
  SUPABASE_ANON_KEY || 'public-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // RN 没有 URL 回调,关掉 URL session 检测。
      detectSessionInUrl: false,
    },
  },
);

// 启动只查、不自动建会话(ADR-0004:登录页提前进 v1,匿名退为一次点击)。
// 有会话(匿名或正式)→ 直接放行,不显示登录页;无会话 → null,交由登录页决定如何创建。
export async function getExistingSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// 匿名登录:仅在登录页点「先随便逛逛」时调用,不再于启动时自动触发。
// 失败即抛出,交调用方在页内给明确重试提示(system-design §11:不静默、不编造)。
// TODO(§16 / ADR-0004):日后在「设置」里提供绑定 Apple / 邮箱,经 supabase.auth.linkIdentity
// 把匿名账号升级为正式账号;升级前数据随设备,卸载重装会丢。该升级流程不在登录页上。
export async function signInAnonymously(): Promise<Session> {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) {
    throw error ?? new Error('匿名登录未返回会话');
  }
  return data.session;
}

// Apple Sign-In(仅 iOS;登录页的 Apple 按钮只在 iOS 渲染)。
// 取 Apple 的 identity token,经 supabase.auth.signInWithIdToken 换 Supabase 会话(ADR-0004)。
// - 用户取消会抛出 code 'ERR_REQUEST_CANCELED',由调用方静默处理(system-design §11)。
// - 后台未配置(Apple Developer / Supabase Apple provider)时,signInWithIdToken 返回 error 而非崩溃,
//   app 照常运行、匿名入口仍可用。
// 注:此处用原生 identity-token 流(Supabase 官方 RN 示例),不需手动 nonce;
//   若日后要防重放加固,可改为向 Apple 传 hashed nonce、向 signInWithIdToken 传原始 nonce。
export async function signInWithApple(): Promise<Session> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) {
    throw new Error('Apple 未返回 identity token');
  }
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error || !data.session) {
    throw error ?? new Error('Apple 登录未返回会话');
  }
  return data.session;
}

// 取当前匿名 JWT,供 AG-UI 请求头携带(见 src/agui/client.ts)。
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
