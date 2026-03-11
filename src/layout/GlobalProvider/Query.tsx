'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren } from 'react';
import React, { useState } from 'react';
import { SWRConfig } from 'swr';

import { swrCacheProvider } from '@/libs/swr/localStorageProvider';
import { lambdaQuery, lambdaQueryClient } from '@/libs/trpc/client';

import SWRMutateInitializer from './SWRMutateInitializer';

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
