'use client';

import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useUserStore } from '@/store/user';

const NoAuthProvider = memo<PropsWithChildren>(({ children }) => {
  const useStoreUpdater = createStoreUpdater(useUserStore);

  useStoreUpdater('isLoaded', true);

  return children;
});

export default NoAuthProvider;
