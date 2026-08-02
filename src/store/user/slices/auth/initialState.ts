import { type SSOProvider } from '@lobechat/types';

import { type LobeUser } from '@/types/user';

export interface UserAuthState {
  authProviders?: SSOProvider[];
  /**
   * Whether user registered with email/password (credential login)
   */
  hasPasswordAccount?: boolean;
  /** Whether the current local cache identity has been authoritatively selected. */
  isIdentityResolved?: boolean;
  isLoaded?: boolean;

  isLoadedAuthProviders?: boolean;

  isSignedIn?: boolean;
  oAuthSSOProviders?: string[];
  user?: LobeUser;
}

export const initialAuthState: UserAuthState = {};
