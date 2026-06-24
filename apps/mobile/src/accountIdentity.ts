// 账号身份派生:登录态 + 显示名 / 副标题 / 头像首字 + provider 解析(Google / Apple)。
// 设置索引页的账号横幅与「账号」详情页是同一行身份的两处呈现,身份派生集中在此,避免两边各写一份
// provider 解析而漂移(过去两处副标题就出现过「已登录」与「Google 用户」不一致)。
//
// 已登录 = 有会话且非匿名;匿名会话(先随便逛逛)仍视为「未登录」。已登录优先显示邮箱,缺邮箱时显示 provider。
// setProviderLabel 暴露给账号页:绑定 Google 成功后可乐观置为 'google',无需等下一次解析。

import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { useI18n } from './i18n';
import { getGoogleProviderLabel } from './google-auth';

export type ProviderLabel = 'google' | 'apple' | 'signed-in';

export function useAccountIdentity() {
  const { t } = useI18n();
  const { session } = useAuth();
  const user = session?.user ?? null;
  const isSignedIn = !!user && !user.is_anonymous;
  const [providerLabel, setProviderLabel] = useState<ProviderLabel>('signed-in');

  useEffect(() => {
    let mounted = true;
    if (!user || user.is_anonymous) {
      setProviderLabel('signed-in');
      return () => {
        mounted = false;
      };
    }
    getGoogleProviderLabel({ appMetadataProvider: user.app_metadata?.provider })
      .then((label) => {
        if (mounted) setProviderLabel(label);
      })
      .catch(() => {
        if (mounted) setProviderLabel('signed-in');
      });
    return () => {
      mounted = false;
    };
  }, [user?.id, user?.is_anonymous, user?.app_metadata?.provider]);

  const providerName =
    providerLabel === 'google' ? t('googleUser') : providerLabel === 'apple' ? t('appleUser') : t('signedInUser');
  const name = isSignedIn ? user?.email || providerName : t('notSignedIn');
  const sub = isSignedIn ? (user?.email ? providerName : '') : t('anonSub');
  const initial = (isSignedIn ? name.charAt(0) : t('guestName').charAt(0) || '你').toUpperCase();

  return { user, isSignedIn, providerLabel, setProviderLabel, providerName, name, sub, initial };
}
