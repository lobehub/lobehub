import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverKeys } from '@/libs/swr/keys';
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
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  useGroupAgentCategories = (params: CategoryListQuery = {}): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      discoverKeys.groupAgentCategories(locale, params),
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
      discoverKeys.groupAgentDetail(locale, params.identifier, params.version),
      async () => discoverService.getGroupAgentDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useGroupAgentIdentifiers = (): SWRResponse<IdentifiersResponse> => {
    return useSWR(
      discoverKeys.groupAgentIdentifiers(),
      async () => discoverService.getGroupAgentIdentifiers(),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useGroupAgentList = (params: GroupAgentQueryParams = {}): SWRResponse<GroupAgentListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      discoverKeys.groupAgentList(locale, params),
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
