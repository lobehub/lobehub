import { BRANDING_NAME } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { type LobeUser, type SSOProvider } from '@lobechat/types';
import { t } from 'i18next';

import { enableAuth, enableBetterAuth, enableClerk, enableNextAuth } from '@/envs/auth';
import type { UserStore } from '@/store/user';

const DEFAULT_USERNAME = BRANDING_NAME;

const nickName = (s: UserStore) => {
  const defaultNickName = s.user?.fullName || s.user?.username;
  if (!enableAuth) {
    if (isDesktop) {
      return defaultNickName;
    }
    return t('userPanel.defaultNickname', { ns: 'common' });
  }

  if (s.isSignedIn) return defaultNickName;

  return t('userPanel.anonymousNickName', { ns: 'common' });
};

const username = (s: UserStore) => {
  if (!enableAuth) {
    if (isDesktop) {
      return s.user?.username;
    }

    return DEFAULT_USERNAME;
  }

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
  isLoginWithBetterAuth: (s: UserStore): boolean => (s.isSignedIn && enableBetterAuth) || false,
  isLoginWithClerk: (s: UserStore): boolean => (s.isSignedIn && enableClerk) || false,
  isLoginWithNextAuth: (s: UserStore): boolean => (s.isSignedIn && !!enableNextAuth) || false,
};
