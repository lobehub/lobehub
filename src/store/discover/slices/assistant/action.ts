import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import {
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type IdentifiersResponse,
} from '@/types/discover';

export interface AssistantAction {
  useAssistantCategories: (
    params: CategoryListQuery & { source?: AssistantMarketSource },
  ) => SWRResponse<CategoryItem[]>;
  useAssistantDetail: (params: {
    identifier: string;
    source?: AssistantMarketSource;
    version?: string;
  }) => SWRResponse<DiscoverAssistantDetail | undefined>;
  useAssistantIdentifiers: (params?: {
    source?: AssistantMarketSource;
  }) => SWRResponse<IdentifiersResponse>;
  useAssistantList: (params?: AssistantQueryParams) => SWRResponse<AssistantListResponse>;
}

export const createAssistantSlice: StateCreator<
  DiscoverStore,
  [['zustand/devtools', never]],
  [],
  AssistantAction
> = () => ({
  useAssistantCategories: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getAssistantCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useAssistantDetail: (params) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-details', locale, params.identifier, params.version, params.source]
        .filter(Boolean)
        .join('-'),
      async () => discoverService.getAssistantDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useAssistantIdentifiers: (params) => {
    return useSWR(
      ['assistant-identifiers', params?.source].filter(Boolean).join('-') || 'assistant-identifiers',
      async () => discoverService.getAssistantIdentifiers(params),
      {
        revalidateOnFocus: false,
      },
    );
  },

  useAssistantList: (params = {}) => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getAssistantList({
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
