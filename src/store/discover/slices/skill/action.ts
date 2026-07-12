import { type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { discoverKeys } from '@/libs/swr/keys';
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

    // Skills imported from a raw URL get a synthetic `url.<host>.<path>`
    // identifier (see server skill importer `url.${host}.${pathPart}`), not a
    // marketplace slug — the market detail lookup can only 404 for them and
    // would otherwise spam the console with 500s + SWR retries. Skip the request
    // and let callers fall back to the locally stored name/description/icon.
    const isMarketIdentifier = !!identifier && !identifier.startsWith('url.');

    return useClientDataSWR(
      !isMarketIdentifier ? null : discoverKeys.skillDetail(locale, identifier, version),
      async () => discoverService.getSkillDetail({ identifier: identifier!, version }),
    );
  };

  useFetchSkillList = (params: SkillQueryParams): SWRResponse<SkillListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(discoverKeys.skillList(locale, params), async () =>
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
      discoverKeys.skillCategories(locale, params),
      async () => discoverService.getSkillCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };
}

export type SkillAction = Pick<SkillActionImpl, keyof SkillActionImpl>;
