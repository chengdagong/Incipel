// Supabase 客户端:用 AsyncStorage 持久化会话(JWT)。
// 客户端只持有匿名 anon key,绝不持有 service key 或任何模型密钥(见 system-design §4)。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // 在开发期尽早暴露缺失的环境变量,避免后续匿名请求静默 401。
  console.warn(
    '[supabase] 缺少 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY,请参照 .env.example 配置。',
  );
}

// 缺环境变量时退回本地默认地址(supabase start 的默认端口),保证 createClient 不在模块加载期抛
// 「supabaseUrl is required」而把整个 app 拦在启动前 —— 后续请求会失败,但已由 ensureSession 兜住
// (本地试用走 agent 的 DEV_NO_AUTH,不依赖 Supabase)。环境变量存在时一律以其为准,不受影响。
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

// 启动时确保存在一个会话:若没有,则匿名登录(system-design §2/§16:账号默认匿名)。
// TODO(§16):提供「绑定邮箱 / 第三方」把匿名账号升级为正式账号(supabase.auth.updateUser /
// linkIdentity);升级前数据随设备,卸载重装会丢。
export async function ensureSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('[supabase] 匿名登录失败:', error.message);
    return null;
  }
  return anon.session;
}

// 取当前匿名 JWT,供 AG-UI 请求头携带(见 src/agui/client.ts)。
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
