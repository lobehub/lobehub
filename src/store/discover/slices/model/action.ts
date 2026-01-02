import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import {
  type DiscoverModelDetail,
  type IdentifiersResponse,
  type ModelListResponse,
  type ModelQueryParams,
} from '@/types/discover';

export interface ModelAction {
  useModelCategories: (params: CategoryListQuery) => SWRResponse<CategoryItem[]>;
  useModelDetail: (params: { identifier: string }) => SWRResponse<DiscoverModelDetail | undefined>;
  useModelIdentifiers: () => SWRResponse<IdentifiersResponse>;
  useModelList: (params?: ModelQueryParams) => SWRResponse<ModelListResponse>;
}

export const createModelSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  ModelAction
> = () => ({
  useModelCategories: (params) => {
    return useSWR(
      ['model-categories', ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getModelCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useModelDetail: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['model-details', locale, params.identifier].filter(Boolean).join('-'),
      async () => discoverService.getModelDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useModelIdentifiers: () => {
    return useSWR('model-identifiers', async () => discoverService.getModelIdentifiers(), {
      revalidateOnFocus: false,
    });
  },

  useModelList: (params = {}) => {
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
  },
});
