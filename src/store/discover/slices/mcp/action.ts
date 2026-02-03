import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverMcpDetail,
  type McpListResponse,
  type McpQueryParams,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createMCPSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new MCPActionImpl(set, get, _api);

export class MCPActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useFetchMcpDetail = ({
    identifier,
    version,
  }: {
    identifier?: string;
    version?: string;
  }): SWRResponse<DiscoverMcpDetail> => {
    const locale = globalHelpers.getCurrentLanguage();

    return useClientDataSWR(
      !identifier ? null : ['mcp-detail', locale, identifier, version].filter(Boolean).join('-'),
      async () => discoverService.getMcpDetail({ identifier: identifier!, version }),
    );
  };

  useFetchMcpList = (params: McpQueryParams): SWRResponse<McpListResponse> => {
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
  };

  useMcpCategories = (params: CategoryListQuery): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['mcp-categories', locale, ...Object.values(params)].join('-'),
      async () => discoverService.getMcpCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };
}

export type MCPAction = Pick<MCPActionImpl, keyof MCPActionImpl>;
