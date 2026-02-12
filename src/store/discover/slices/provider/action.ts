import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverProviderDetail,
  type IdentifiersResponse,
  type ProviderListResponse,
  type ProviderQueryParams,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createProviderSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new ProviderActionImpl(set, get, _api);

export class ProviderActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useProviderDetail = (params: {
    identifier: string;
    withReadme?: boolean;
  }): SWRResponse<DiscoverProviderDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['provider-details', locale, params.identifier].filter(Boolean).join('-'),
      async () => discoverService.getProviderDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useProviderIdentifiers = (): SWRResponse<IdentifiersResponse> => {
    return useSWR('provider-identifiers', async () => discoverService.getProviderIdentifiers(), {
      revalidateOnFocus: false,
    });
  };

  useProviderList = (params: ProviderQueryParams = {}): SWRResponse<ProviderListResponse> => {
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
  };
}

export type ProviderAction = Pick<ProviderActionImpl, keyof ProviderActionImpl>;
