import { isEqual } from 'es-toolkit';
import { shallow } from 'zustand/shallow';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { resourceService } from '@/services/resource';
import { type ResourceQueryParams } from '@/types/resource';

import { useFileStore } from '../../store';

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
  return useClientDataSWR(
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
      // SWR configuration for optimal UX
      dedupingInterval: 2000,
      onSuccess: (data: { hasMore: boolean; items: any[]; total?: number }) => {
        const { resourceList, resourceMap } = useFileStore.getState();

        const newResourceMap = new Map(data.items.map((item) => [item.id, item]));
        const newResourceList = data.items;

        // Only update store if data actually changed
        if (!isEqual(newResourceList, resourceList) || !isEqual(newResourceMap, resourceMap)) {
          useFileStore.setState(
            {
              hasMore: data.hasMore,
              offset: data.items.length,
              queryParams: params ?? undefined,
              resourceList: newResourceList,
              resourceMap: newResourceMap,
              total: data.total,
            },
            false,
            'useFetchResources/success',
          );
        }
      },
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );
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
