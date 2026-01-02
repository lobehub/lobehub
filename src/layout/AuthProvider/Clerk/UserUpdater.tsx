'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { memo } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useUserStore } from '@/store/user';
import { type LobeUser } from '@/types/user';

// update the user data into the context
const UserUpdater = memo(() => {
  const { isLoaded, user, isSignedIn } = useUser();

  const { session, openUserProfile, signOut, openSignIn } = useClerk();

  const useStoreUpdater = createStoreUpdater(useUserStore);

  const lobeUser = {
    avatar: user?.imageUrl,
    firstName: user?.firstName,
    fullName: user?.fullName,
    id: user?.id,
    latestName: user?.lastName,
    username: user?.username,
  } as LobeUser;

  useStoreUpdater('isLoaded', isLoaded);
  useStoreUpdater('user', lobeUser);
  useStoreUpdater('isSignedIn', isSignedIn);

  useStoreUpdater('clerkUser', user!);
  useStoreUpdater('clerkSession', session!);
  useStoreUpdater('clerkSignIn', openSignIn);
  useStoreUpdater('clerkOpenUserProfile', openUserProfile);
  useStoreUpdater('clerkSignOut', signOut);

  return null;
});

export default UserUpdater;
