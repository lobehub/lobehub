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
  type DiscoverSkillItem,
  type SkillCategoryItem,
  type SkillCommentListResponse,
  type SkillCommentsQueryParams,
  type SkillListResponse,
  type SkillQueryParams,
  type SkillRatingDistribution,
  SkillSorts,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;

/** How many related skills the detail view shows alongside the skill itself */
const RELATED_SKILLS_COUNT = 6;

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

  /**
   * Related skills for the detail view, composed client-side from the list
   * endpoint. Kept out of `getSkillDetail` on purpose: that query also backs
   * per-skill icon/metadata lookups (one per installed skill in the chat tools
   * panel), which must not pay for an extra upstream list request.
   */
  useFetchRelatedSkills = ({
    category,
    identifier,
  }: {
    category?: string;
    identifier?: string;
  }): SWRResponse<DiscoverSkillItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      category && identifier ? discoverKeys.skillRelated(locale, category, identifier) : null,
      async (): Promise<DiscoverSkillItem[]> => {
        const list = await discoverService.getSkillList({
          category,
          page: 1,
          // Fetch one extra so the cap still holds after dropping the skill itself
          pageSize: RELATED_SKILLS_COUNT + 1,
          sort: SkillSorts.Recommended,
        });
        return list.items
          .filter((item) => item.identifier !== identifier)
          .slice(0, RELATED_SKILLS_COUNT);
      },
    );
  };

  useFetchSkillComments = ({
    identifier,
    ...params
  }: Partial<SkillCommentsQueryParams>): SWRResponse<SkillCommentListResponse> => {
    return useClientDataSWR(
      identifier ? discoverKeys.skillComments(identifier, params) : null,
      async () => discoverService.getSkillComments({ identifier: identifier!, ...params }),
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

  useFetchSkillRatingDistribution = (identifier?: string): SWRResponse<SkillRatingDistribution> => {
    return useClientDataSWR(
      identifier ? discoverKeys.skillRatingDistribution(identifier) : null,
      async () => discoverService.getSkillRatingDistribution(identifier!),
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
