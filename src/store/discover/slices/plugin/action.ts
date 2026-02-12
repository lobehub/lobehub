import {
  type DiscoverPluginDetail,
  type IdentifiersResponse,
  type PluginListResponse,
  type PluginQueryParams,
} from '@lobechat/types';
import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<DiscoverStore>;
export const createPluginSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new PluginActionImpl(set, get, _api);

export class PluginActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  usePluginCategories = (params: CategoryListQuery): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['plugin-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getPluginCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  usePluginDetail = ({
    identifier,
    withManifest,
  }: {
    identifier?: string;
    withManifest?: boolean;
  }): SWRResponse<DiscoverPluginDetail | undefined> => {
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
  };

  usePluginIdentifiers = (): SWRResponse<IdentifiersResponse> => {
    return useSWR('plugin-identifiers', async () => discoverService.getPluginIdentifiers(), {
      revalidateOnFocus: false,
    });
  };

  usePluginList = (params: PluginQueryParams = {}): SWRResponse<PluginListResponse> => {
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
  };
}

export type PluginAction = Pick<PluginActionImpl, keyof PluginActionImpl>;
