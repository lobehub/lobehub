import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import {
  type DiscoverMcpDetail,
  type McpListResponse,
  type McpQueryParams,
} from '@/types/discover';

export interface MCPAction {
  useFetchMcpDetail: (params: {
    identifier?: string;
    version?: string;
  }) => SWRResponse<DiscoverMcpDetail>;
  useFetchMcpList: (params: McpQueryParams) => SWRResponse<McpListResponse>;
  useMcpCategories: (params: CategoryListQuery) => SWRResponse<CategoryItem[]>;
}

export const createMCPSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  MCPAction
> = () => ({
  useFetchMcpDetail: ({ identifier, version }) => {
    const locale = globalHelpers.getCurrentLanguage();

    return useClientDataSWR(
      !identifier ? null : ['mcp-detail', locale, identifier, version].filter(Boolean).join('-'),
      async () => discoverService.getMcpDetail({ identifier: identifier!, version }),
    );
  },

  useFetchMcpList: (params: any) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['mcp-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getMcpList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
    );
  },

  useMcpCategories: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['mcp-categories', locale, ...Object.values(params)].join('-'),
      async () => discoverService.getMcpCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  },
});
