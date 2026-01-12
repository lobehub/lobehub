'use client';

import { useSession } from 'next-auth/react';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useUserStore } from '@/store/user';
import { LobeUser } from '@/types/user';

// update the user data into the context
const UserUpdater = memo(() => {
  const { data: session, status } = useSession();
  const isLoaded = status !== 'loading';

  const isSignedIn = (status === 'authenticated' && session && !!session.user) || false;

  const nextUser = session?.user;
  const useStoreUpdater = createStoreUpdater(useUserStore);

  useStoreUpdater('isLoaded', isLoaded);
  useStoreUpdater('isSignedIn', isSignedIn);
  useStoreUpdater('nextSession', session || undefined);

  // 使用 useEffect 处理需要保持同步的用户数据
  useEffect(() => {
    if (nextUser) {
      const userAvatar = useUserStore.getState().user?.avatar;

      const lobeUser = {
        // 头像使用设置的，而不是从 next-auth 中获取
        avatar: userAvatar || '',
        email: nextUser.email,
        fullName: nextUser.name,
        id: nextUser.id,
      } as LobeUser;

      // 更新用户相关数据
      useUserStore.setState({ nextUser: nextUser, user: lobeUser });
    }
  }, [nextUser]);
  return null;
});

export default UserUpdater;
