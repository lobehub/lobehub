import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverModelDetail,
  type IdentifiersResponse,
  type ModelListResponse,
  type ModelQueryParams,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createModelSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new ModelActionImpl(set, get, _api);

export class ModelActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useModelCategories = (params: CategoryListQuery): SWRResponse<CategoryItem[]> => {
    return useSWR(
      ['model-categories', ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getModelCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useModelDetail = (params: {
    identifier: string;
  }): SWRResponse<DiscoverModelDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['model-details', locale, params.identifier].filter(Boolean).join('-'),
      async () => discoverService.getModelDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useModelIdentifiers = (): SWRResponse<IdentifiersResponse> => {
    return useSWR('model-identifiers', async () => discoverService.getModelIdentifiers(), {
      revalidateOnFocus: false,
    });
  };

  useModelList = (params: ModelQueryParams = {}): SWRResponse<ModelListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['model-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getModelList({
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

export type ModelAction = Pick<ModelActionImpl, keyof ModelActionImpl>;
