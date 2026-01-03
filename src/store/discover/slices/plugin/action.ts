import {
  type DiscoverPluginDetail,
  type IdentifiersResponse,
  type PluginListResponse,
  type PluginQueryParams,
} from '@lobechat/types';
import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';

export interface PluginAction {
  usePluginCategories: (params: CategoryListQuery) => SWRResponse<CategoryItem[]>;
  usePluginDetail: (params: {
    identifier?: string;
    withManifest?: boolean;
  }) => SWRResponse<DiscoverPluginDetail | undefined>;
  usePluginIdentifiers: () => SWRResponse<IdentifiersResponse>;
  usePluginList: (params?: PluginQueryParams) => SWRResponse<PluginListResponse>;
}

export const createPluginSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  PluginAction
> = () => ({
  usePluginCategories: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['plugin-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getPluginCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  usePluginDetail: ({ identifier, withManifest }) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      !identifier
        ? null
        : ['plugin-details', locale, identifier, withManifest].filter(Boolean).join('-'),
      async () => discoverService.getPluginDetail({ identifier: identifier!, withManifest }),
      {
        revalidateOnFocus: false,
      },
    );
  },

  usePluginIdentifiers: () => {
    return useSWR('plugin-identifiers', async () => discoverService.getPluginIdentifiers(), {
      revalidateOnFocus: false,
    });
  },

  usePluginList: (params = {}) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['plugin-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getPluginList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
      {
        revalidateOnFocus: false,
      },
    );
  },
});
