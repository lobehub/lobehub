import { type SSOProvider } from '@lobechat/types';
import { type StateCreator } from 'zustand/vanilla';

import type { UserStore } from '../../store';

interface AuthProvidersData {
  hasPasswordAccount: boolean;
  providers: SSOProvider[];
}

export interface UserAuthAction {
  /**
   * Fetch auth providers (SSO accounts) for the current user
   */
  fetchAuthProviders: () => Promise<void>;
  /**
   * universal logout method
   */
  logout: () => Promise<void>;
  /**
   * universal login method
   */
  openLogin: () => Promise<void>;
  /**
   * Refresh auth providers after link/unlink
   */
  refreshAuthProviders: () => Promise<void>;
}

const fetchAuthProvidersData = async (): Promise<AuthProvidersData> => {
  const { accountInfo, listAccounts } = await import('@/libs/better-auth/auth-client');
  const result = await listAccounts();
  const accounts = result.data || [];
  const hasPasswordAccount = accounts.some((account) => account.providerId === 'credential');
  const providers = await Promise.all(
    accounts
      .filter((account) => account.providerId !== 'credential')
      .map(async (account) => {
        // In theory, the id_token could be decrypted from the accounts table, but I found that better-auth on GitHub does not save the id_token
        const info = await accountInfo({
          query: { accountId: account.accountId },
        });
        return {
          email: info.data?.user?.email ?? undefined,
          provider: account.providerId,
          providerAccountId: account.accountId,
        };
      }),
  );
  return { hasPasswordAccount, providers };
};

export const createAuthSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  UserAuthAction
> = (set, get) => ({
  fetchAuthProviders: async () => {
    // Skip if already loaded
    if (get().isLoadedAuthProviders) return;

    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      set({ authProviders: providers, hasPasswordAccount, isLoadedAuthProviders: true });
    } catch (error) {
      console.error('Failed to fetch auth providers:', error);
      set({ isLoadedAuthProviders: true });
    }
  },
  logout: async () => {
    const { signOut } = await import('@/libs/better-auth/auth-client');
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          // Use window.location.href to trigger a full page reload
          // This ensures all client-side state (React, Zustand, cache) is cleared
          window.location.href = '/signin';
        },
      },
    });
  },
  openLogin: async () => {
    // Skip if already on a login page (/signin, /signup)
    const pathname = location.pathname;
    if (pathname.startsWith('/signin') || pathname.startsWith('/signup')) {
      return;
    }

    const currentUrl = location.toString();
    window.location.href = `/signin?callbackUrl=${encodeURIComponent(currentUrl)}`;
  },
  refreshAuthProviders: async () => {
    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      set({ authProviders: providers, hasPasswordAccount });
    } catch (error) {
      console.error('Failed to refresh auth providers:', error);
    }
  },
});
