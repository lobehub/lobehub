import { isEqual } from 'es-toolkit';
import { useEffect } from 'react';
import { shallow } from 'zustand/shallow';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { resourceService } from '@/services/resource';
import { type ResourceQueryParams } from '@/types/resource';

import { useFileStore } from '../../store';
import { mergeServerResourcesWithOptimistic } from './utils';

const SWR_KEY_RESOURCES = 'SWR_RESOURCES';

/**
 * Revalidate resources with current or specific query params
 * This can be called from outside React components (e.g., store actions)
 */
export const revalidateResources = async (params?: ResourceQueryParams) => {
  const queryParams = params || useFileStore.getState().queryParams;
  if (queryParams) {
    await mutate([SWR_KEY_RESOURCES, queryParams]);
  }
};

/**
 * Custom SWR hook for fetching resources with caching and revalidation
 */
export const useFetchResources = (params: ResourceQueryParams | null, enable: any = true) => {
  const swr = useClientDataSWR(
    enable && params ? [SWR_KEY_RESOURCES, params] : null,
    async ([, queryParams]: [string, ResourceQueryParams]) => {
      const response = await resourceService.queryResources({
        ...queryParams,
        limit: queryParams.limit || 50,
        offset: 0,
      });
      return response;
    },
    {
      // Skip background revalidation when a fresh fetch for the same key
      // happened recently. Cache-hit display still works because the
      // useEffect below syncs swr.data → store regardless of whether the
      // fetcher actually ran.
      dedupingInterval: 30 * 1000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );

  // Sync SWR data → store on every data ref change.
  // Using useEffect (not onSuccess) covers the cache-hit path: when the key
  // changes to a previously-fetched folder, SWR returns cached data synchronously
  // without firing onSuccess. Reading the store mirror alone would surface the
  // previously-written folder's data until revalidation completes.
  const data = swr.data;
  useEffect(() => {
    if (!data || !params) return;

    const { resourceList, resourceMap } = useFileStore.getState();
    const merged = mergeServerResourcesWithOptimistic(data.items, resourceMap, params);

    if (!isEqual(merged.resourceList, resourceList) || !isEqual(merged.resourceMap, resourceMap)) {
      useFileStore.setState(
        {
          hasMore: data.hasMore,
          offset: data.items.length,
          queryParams: params,
          resourceList: merged.resourceList,
          resourceMap: merged.resourceMap,
          total: data.total,
        },
        false,
        'useFetchResources/sync',
      );
    }
  }, [data, params]);

  return swr;
};

/**
 * Hook to access resource store state
 */
export const useResourceStore = () => {
  return useFileStore(
    (s) => ({
      hasMore: s.hasMore,
      queryParams: s.queryParams,
      resourceList: s.resourceList,
      resourceMap: s.resourceMap,
      total: s.total,
    }),
    shallow,
  );
};
