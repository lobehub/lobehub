import { type LobeUser, type SSOProvider } from '@lobechat/types';
import { t } from 'i18next';

import { type UserStore } from '@/store/user';

const nickName = (s: UserStore) => {
  const defaultNickName = s.user?.fullName || s.user?.username;
  if (s.isSignedIn) return defaultNickName;

  return t('userPanel.anonymousNickName', { ns: 'common' });
};

const username = (s: UserStore) => {
  if (s.isSignedIn) return s.user?.username;

  return 'anonymous';
};

export const userProfileSelectors = {
  displayUserName: (s: UserStore): string => s.user?.fullName || username(s) || s.user?.email || '',
  email: (s: UserStore): string => s.user?.email || '',
  fullName: (s: UserStore): string => s.user?.fullName || '',
  interests: (s: UserStore): string[] => s.user?.interests || [],
  nickName,
  userAvatar: (s: UserStore): string => s.user?.avatar || '',
  userId: (s: UserStore) => s.user?.id,
  userProfile: (s: UserStore): LobeUser | null | undefined => s.user,
  username,
};

export const authSelectors = {
  authProviders: (s: UserStore): SSOProvider[] => s.authProviders || [],
  hasPasswordAccount: (s: UserStore) => s.hasPasswordAccount ?? false,
  isFreePlan: (s: UserStore) => s.isFreePlan,
  isLoaded: (s: UserStore) => s.isLoaded,
  isLoadedAuthProviders: (s: UserStore) => s.isLoadedAuthProviders ?? false,
  isLogin: (s: UserStore) => s.isSignedIn,
  isLoginWithAuth: (s: UserStore) => s.isSignedIn,
};
