import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import {
  type DiscoverGroupAgentDetail,
  type GroupAgentListResponse,
  type GroupAgentQueryParams,
  type IdentifiersResponse,
} from '@/types/discover';

export interface GroupAgentAction {
  useGroupAgentCategories: (params?: CategoryListQuery) => SWRResponse<CategoryItem[]>;
  useGroupAgentDetail: (params: {
    identifier: string;
    version?: string;
  }) => SWRResponse<DiscoverGroupAgentDetail | undefined>;
  useGroupAgentIdentifiers: () => SWRResponse<IdentifiersResponse>;
  useGroupAgentList: (params?: GroupAgentQueryParams) => SWRResponse<GroupAgentListResponse>;
}

export const createGroupAgentSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  GroupAgentAction
> = () => ({
  useGroupAgentCategories: (params = {}) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['group-agent-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getGroupAgentCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useGroupAgentDetail: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['group-agent-details', locale, params.identifier, params.version]
        .filter(Boolean)
        .join('-'),
      async () => discoverService.getGroupAgentDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useGroupAgentIdentifiers: () => {
    return useSWR(
      'group-agent-identifiers',
      async () => discoverService.getGroupAgentIdentifiers(),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useGroupAgentList: (params = {}) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['group-agent-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getGroupAgentList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 20,
        }),
      {
        revalidateOnFocus: false,
      },
    );
  },
});
