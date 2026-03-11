import { type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverSkillDetail,
  type SkillCategoryItem,
  type SkillListResponse,
  type SkillQueryParams,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;

export const createSkillSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new SkillActionImpl(set, get, _api);

export class SkillActionImpl {
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  useFetchSkillDetail = ({
    identifier,
    version,
  }: {
    identifier?: string;
    version?: string;
  }): SWRResponse<DiscoverSkillDetail> => {
    const locale = globalHelpers.getCurrentLanguage();

    return useClientDataSWR(
      !identifier ? null : ['skill-detail', locale, identifier, version].filter(Boolean).join('-'),
      async () => discoverService.getSkillDetail({ identifier: identifier!, version }),
    );
  };

  useFetchSkillList = (params: SkillQueryParams): SWRResponse<SkillListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['skill-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getSkillList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
    );
  };

  useSkillCategories = (params: CategoryListQuery = {}): SWRResponse<SkillCategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['skill-categories', locale, ...Object.values(params)].join('-'),
      async () => discoverService.getSkillCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };
}

export type SkillAction = Pick<SkillActionImpl, keyof SkillActionImpl>;
