'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { type PropsWithChildren, useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { setScopedMutate } from '@/libs/swr';
import { applyDesktopBootstrapIdentity } from '@/spa/initialize/desktopIdentity';

/**
 * Initialize scoped mutate for use outside React components (e.g., Zustand stores)
 * Desktop variant: also listens to Electron IPC for remote server config updates
 */
const SWRMutateInitializer = ({ children }: PropsWithChildren) => {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    setScopedMutate(mutate);
  }, [mutate]);

  useWatchBroadcast('remoteServerConfigUpdated', () => {
    try {
      // Token changes can switch the local cache partition. Apply the new
      // safe-storage identity before revalidating any SWR key.
      applyDesktopBootstrapIdentity();
      const result = mutate(() => true, undefined, { revalidate: true });
      void result?.catch?.(() => {});
    } catch {
      // Ignore: SWR cache may not be ready yet in early boot.
    }
  });

  return <>{children}</>;
};

export default SWRMutateInitializer;
