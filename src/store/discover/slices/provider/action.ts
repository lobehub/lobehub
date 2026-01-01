import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import {
  type DiscoverProviderDetail,
  type IdentifiersResponse,
  type ProviderListResponse,
  type ProviderQueryParams,
} from '@/types/discover';

export interface ProviderAction {
  useProviderDetail: (params: {
    identifier: string;
    withReadme?: boolean;
  }) => SWRResponse<DiscoverProviderDetail | undefined>;
  useProviderIdentifiers: () => SWRResponse<IdentifiersResponse>;
  useProviderList: (params?: ProviderQueryParams) => SWRResponse<ProviderListResponse>;
}

export const createProviderSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  ProviderAction
> = () => ({
  useProviderDetail: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['provider-details', locale, params.identifier].filter(Boolean).join('-'),
      async () => discoverService.getProviderDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useProviderIdentifiers: () => {
    return useSWR('provider-identifiers', async () => discoverService.getProviderIdentifiers(), {
      revalidateOnFocus: false,
    });
  },

  useProviderList: (params = {}) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['provider-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getProviderList({
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
