'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { type Cache, SWRConfig } from 'swr';

import { mutate } from '@/libs/swr';
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

  // Keep the SWR cache provider inside SWRConfig's lifecycle. SWR registers
  // global state for the returned Map during Provider render, so creating and
  // hydrating that same Map from SPA bootstrap can leave hooks with an
  // unregistered cache after remounts.
  const [provider] = useState(() => swrCacheProvider(getCacheScope, cacheHydration.markReady));

  const scope = useCacheScope();
  const lastScope = useRef(scope);
  useLayoutEffect(() => {
    if (lastScope.current === scope) return;

    lastScope.current = scope;
    cacheHydration.markPending(scope);
    const reloadScope = provider.reloadScope;
    if (!reloadScope) return;

    // `reloadScope()` swaps the provider Map's persisted entries to the new
    // scope in place, but SWR does not observe direct Map mutation. Mounted
    // consumers whose key does not change across the swap (e.g. keys embedding
    // only a scope-stable agent/topic id, since `augmentKey` adds workspaceId
    // but never userId) would otherwise keep rendering the previous scope's
    // data until an incidental revalidation. Broadcast a global revalidation
    // once the swap resolves so every consumer re-reads under the new scope —
    // the CacheHydrationGate latch keeps the tree mounted, so this replaces the
    // correctness role the old `key={scope}` remount used to play.
    void reloadScope()
      .then(() => mutate(() => true, undefined, { revalidate: true }))
      .catch((error) => {
        console.error('[SWR Cache] failed to reload scope', error);
      });
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
