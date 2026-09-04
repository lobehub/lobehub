'use client';

import { type PropsWithChildren } from 'react';

import { createTabRouter } from '@/spa/router/tabRouter';
import { useElectronStore } from '@/store/electron';
import { RouterStoreProvider } from '@/store/router';

import { getOrCreateTabRouter } from './tabRouterManager';

const ActiveTabRouterStoreProvider = ({ children }: PropsWithChildren) => {
  const activeTabId = useElectronStore((state) => state.activeTabId);
  const activeTabUrl = useElectronStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.url,
  );

  const router =
    activeTabId && activeTabUrl
      ? getOrCreateTabRouter(activeTabId, activeTabUrl, createTabRouter)
      : undefined;

  return (
    <RouterStoreProvider router={router} scopeId={activeTabId ?? undefined}>
      {children}
    </RouterStoreProvider>
  );
};

export default ActiveTabRouterStoreProvider;
