import { type Session, type User } from '@auth/core/types';
import {
  type SignInProps,
  type SignOut,
  type SignedInSessionResource,
  type UserProfileProps,
  type UserResource,
} from '@clerk/types';
import { type SSOProvider } from '@lobechat/types';

import { enableClerk } from '@/const/auth';
import { type LobeUser } from '@/types/user';

export interface UserAuthState {
  authProviders?: SSOProvider[];
  clerkOpenUserProfile?: (props?: UserProfileProps) => void;
  clerkSession?: SignedInSessionResource;

  clerkSignIn?: (props?: SignInProps) => void;
  clerkSignOut?: SignOut;
  clerkUser?: UserResource;
  /**
   * Whether user registered with email/password (credential login)
   */
  hasPasswordAccount?: boolean;
  isLoaded?: boolean;
  isLoadedAuthProviders?: boolean;

  isSignedIn?: boolean;
  nextSession?: Session;
  nextUser?: User;
  oAuthSSOProviders?: string[];
  user?: LobeUser;
}

export const initialAuthState: UserAuthState = {
  // Clerk doesn't need to fetch auth providers
  isLoadedAuthProviders: enableClerk ? true : undefined,
};
