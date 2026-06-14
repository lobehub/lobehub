'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren } from 'react';
import React, { useEffect, useRef, useState } from 'react';
import { type Cache, SWRConfig } from 'swr';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { swrCacheProvider } from '@/libs/swr/localStorageProvider';
import { getCacheScope, useCacheScope } from '@/libs/swr/useCacheScope';
import { lambdaQuery, lambdaQueryClient } from '@/libs/trpc/client';

import SWRMutateInitializer from './SWRMutateInitializer';

const QueryProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(() => new QueryClient());
  // Cast required because pnpm installs separate QueryClient type instances for trpc and app
  const providerQueryClient = queryClient as unknown as React.ComponentProps<
    typeof lambdaQuery.Provider
  >['queryClient'];

  // The persistence namespace follows the live identity scope. `getCacheScope`
  // is read lazily on every load/save, so we don't recreate the provider (and
  // remount the tree) when the scope changes — instead we re-hydrate in place.
  // `cacheHydration.markReady` lets the boot gate wait for the IndexedDB tier.
  const [provider] = useState(() => swrCacheProvider(getCacheScope, cacheHydration.markReady));

  // Re-hydrate the cache from the new scope's namespace whenever the signed-in
  // user or active workspace changes (e.g. once async auth resolves), so data
  // never leaks across scopes and the correct local data is surfaced.
  const scope = useCacheScope();
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    provider.reloadScope?.();
  }, [scope, provider]);

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
