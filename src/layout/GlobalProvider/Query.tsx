'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren } from 'react';
import React, { useEffect, useState } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';

import { setScopedMutate } from '@/libs/swr';
import { swrCacheProvider } from '@/libs/swr/localStorageProvider';
import { lambdaQuery, lambdaQueryClient } from '@/libs/trpc/client';

/**
 * Initialize scoped mutate for use outside React components (e.g., Zustand stores)
 * This component must be rendered inside SWRConfig to access the scoped mutate
 */
const SWRMutateInitializer = ({ children }: PropsWithChildren) => {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    setScopedMutate(mutate);
  }, [mutate]);

  useWatchBroadcast('remoteServerConfigUpdated', () => {
    try {
      const result = mutate(() => true, undefined, { revalidate: true });
      void result?.catch?.(() => {});
    } catch {
      // Ignore: SWR cache may not be ready yet in early boot.
    }
  });

  return <>{children}</>;
};

const QueryProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(() => new QueryClient());
  // Cast required because pnpm installs separate QueryClient type instances for trpc and app
  const providerQueryClient = queryClient as unknown as React.ComponentProps<
    typeof lambdaQuery.Provider
  >['queryClient'];

  // 使用 useState 确保 provider 只创建一次
  const [provider] = useState(swrCacheProvider);

  return (
    <SWRConfig value={{ provider }}>
      <SWRMutateInitializer>
        <lambdaQuery.Provider client={lambdaQueryClient} queryClient={providerQueryClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </lambdaQuery.Provider>
      </SWRMutateInitializer>
    </SWRConfig>
  );
};

export default QueryProvider;
