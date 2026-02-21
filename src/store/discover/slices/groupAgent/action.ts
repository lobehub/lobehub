import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverGroupAgentDetail,
  type GroupAgentListResponse,
  type GroupAgentQueryParams,
  type IdentifiersResponse,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createGroupAgentSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new GroupAgentActionImpl(set, get, _api);

export class GroupAgentActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useGroupAgentCategories = (params: CategoryListQuery = {}): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['group-agent-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getGroupAgentCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useGroupAgentDetail = (params: {
    identifier: string;
    version?: string;
  }): SWRResponse<DiscoverGroupAgentDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['group-agent-details', locale, params.identifier, params.version].filter(Boolean).join('-'),
      async () => discoverService.getGroupAgentDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useGroupAgentIdentifiers = (): SWRResponse<IdentifiersResponse> => {
    return useSWR(
      'group-agent-identifiers',
      async () => discoverService.getGroupAgentIdentifiers(),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useGroupAgentList = (params: GroupAgentQueryParams = {}): SWRResponse<GroupAgentListResponse> => {
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
  };
}

export type GroupAgentAction = Pick<GroupAgentActionImpl, keyof GroupAgentActionImpl>;
