'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import React, { useLayoutEffect, useRef, useState } from 'react';

import { mutate } from '@/libs/swr';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { lambdaQuery, lambdaQueryClient } from '@/libs/trpc/client';

import SWRMutateInitializer from './SWRMutateInitializer';

const QueryProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(() => new QueryClient());
  // Cast required because pnpm installs separate QueryClient type instances for trpc and app
  const providerQueryClient = queryClient as unknown as React.ComponentProps<
    typeof lambdaQuery.Provider
  >['queryClient'];

  // No SWR cache provider: SWR keeps request state in its default in-memory
  // cache and persists nothing (server data the UI paints lives in replicas,
  // `@/libs/replica`). Keys embed the workspace (`augmentKey`) but never the
  // user, so on a scope change (sign-in, account or workspace switch) drop
  // every cached value and revalidate the mounted consumers: none keeps
  // rendering the previous scope's data.
  const scope = useCacheScope();
  const lastScope = useRef(scope);
  useLayoutEffect(() => {
    if (lastScope.current === scope) return;

    lastScope.current = scope;
    void mutate(() => true, undefined, { revalidate: true }).catch((error) => {
      console.error('[SWR] failed to reset the cache on scope change', error);
    });
  }, [scope]);

  return (
    <SWRMutateInitializer>
      <lambdaQuery.Provider client={lambdaQueryClient} queryClient={providerQueryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </lambdaQuery.Provider>
    </SWRMutateInitializer>
  );
};

export default QueryProvider;
