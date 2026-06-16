'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren } from 'react';
import React, { useState } from 'react';
import { type Cache, SWRConfig } from 'swr';

import { appSWRCacheProvider } from '@/libs/swr/appCacheProvider';
import { lambdaQuery, lambdaQueryClient } from '@/libs/trpc/client';

import SWRMutateInitializer from './SWRMutateInitializer';

const QueryProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(() => new QueryClient());
  // Cast required because pnpm installs separate QueryClient type instances for trpc and app
  const providerQueryClient = queryClient as unknown as React.ComponentProps<
    typeof lambdaQuery.Provider
  >['queryClient'];

  // Reuse the app-level SWR provider initialized by the SPA bootstrap, so React
  // consumes the same cache map that the bootstrap hydrates.
  const [provider] = useState(() => appSWRCacheProvider);

  return (
    <SWRConfig value={{ provider: provider as unknown as (cache: Readonly<Cache>) => Cache }}>
      <SWRMutateInitializer>
        <lambdaQuery.Provider client={lambdaQueryClient} queryClient={providerQueryClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </lambdaQuery.Provider>
      </SWRMutateInitializer>
    </SWRConfig>
  );
};

export default QueryProvider;
