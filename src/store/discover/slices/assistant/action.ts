import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type IdentifiersResponse,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createAssistantSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new AssistantActionImpl(set, get, _api);

export class AssistantActionImpl {
  readonly #get: () => DiscoverStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useAssistantCategories = (
    params: CategoryListQuery & { source?: AssistantMarketSource },
  ): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getAssistantCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useAssistantDetail = (params: {
    identifier: string;
    source?: AssistantMarketSource;
    version?: string;
  }): SWRResponse<DiscoverAssistantDetail | undefined> => {
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
  };

  useAssistantIdentifiers = (params?: {
    source?: AssistantMarketSource;
  }): SWRResponse<IdentifiersResponse> => {
    return useSWR(
      ['assistant-identifiers', params?.source].filter(Boolean).join('-') ||
        'assistant-identifiers',
      async () => discoverService.getAssistantIdentifiers(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useAssistantList = (params: AssistantQueryParams = {}): SWRResponse<AssistantListResponse> => {
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
  };
}

export type AssistantAction = Pick<AssistantActionImpl, keyof AssistantActionImpl>;
