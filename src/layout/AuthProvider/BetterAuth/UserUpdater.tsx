'use client';

import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useSession } from '@/libs/better-auth/auth-client';
import { useUserStore } from '@/store/user';
import type {LobeUser} from '@/types/user';

/**
 * Sync Better-Auth session state to Zustand store
 */
const UserUpdater = memo(() => {
  const { data: session, isPending, error } = useSession();

  const isLoaded = !isPending;
  const isSignedIn = !!session?.user && !error;

  const betterAuthUser = session?.user;
  const useStoreUpdater = createStoreUpdater(useUserStore);

  useStoreUpdater('isLoaded', isLoaded);
  useStoreUpdater('isSignedIn', isSignedIn);

  // Sync user data from Better-Auth session to Zustand store
  useEffect(() => {
    if (betterAuthUser) {
      const userAvatar = useUserStore.getState().user?.avatar;

      const lobeUser = {
        // Preserve avatar from settings, don't override with auth provider value
        avatar: userAvatar || '',
        email: betterAuthUser.email,
        fullName: betterAuthUser.name,
        id: betterAuthUser.id,
        username: betterAuthUser.username,
      } as LobeUser;

      // Update user data in store
      useUserStore.setState({ user: lobeUser });
      return;
    }

    // Clear user data when session becomes unavailable
    useUserStore.setState({ user: undefined });
  }, [betterAuthUser]);

  return null;
});

export default UserUpdater;
