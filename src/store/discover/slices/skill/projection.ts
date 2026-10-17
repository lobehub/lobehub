import type { CategoryListQuery } from '@lobehub/market-sdk';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import type {
  DiscoverSkillDetail,
  DiscoverSkillItem,
  SkillCategoryItem,
  SkillCommentListResponse,
  SkillCommentsQueryParams,
  SkillListResponse,
  SkillQueryParams,
  SkillRatingDistribution,
} from '@/types/discover';
import { SkillSorts } from '@/types/discover';

/**
 * The marketplace skill reads are **read-only**: no optimistic write, no
 * cross-copy entity link. What the replica buys here is the first frame — the
 * last confirmed page paints before the network answers — and one cache
 * partition per identity (the `cacheScope`), so switching account or workspace
 * never serves the previous one's rows.
 *
 * Each distinct query is its own entry (`key`), exactly like the SWR key it
 * replaces: the community list paginates by URL (`?page=N`), so a page flip is
 * a different entry rather than a `loadMore` of the same one.
 */

/** How many related skills the detail view shows alongside the skill itself */
export const RELATED_SKILLS_COUNT = 6;

// ============================== List ==============================

/** Normalized `skillList` params — the shape actually sent to the market endpoint. */
export interface SkillListParams extends Omit<SkillQueryParams, 'page' | 'pageSize'> {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
  page: number;
  pageSize: number;
}

/** Entry key of one skill list query (page / filters / locale). */
export const skillListQueryKey = (params: SkillListParams): string => stableQueryKey(params);

/**
 * Skill market list, one entry per query (`skillListMap[key]`). The response
 * already carries everything a row reader needs (`items`, `currentPage`,
 * `pageSize`, `totalCount`), so it is stored as-is.
 */
export const skillListResource = defineReplica<SkillListParams, SkillListResponse>({
  fetcher: (params) => discoverService.getSkillList(params),
  key: skillListQueryKey,
  name: 'skillList',
  storage: 'indexedDB',
  version: 1,
});

// ============================== Detail ==============================

export interface SkillDetailParams {
  identifier: string;
  /** Current UI language; the market resolves localized copy server-side. */
  locale?: string;
  version?: string;
}

/** Entry key of one skill detail (`identifier`, localized, optional version). */
export const skillDetailQueryKey = (params: SkillDetailParams): string => stableQueryKey(params);

/**
 * One skill detail by identifier (`skillDetailMap[key]`). Skills imported from
 * a raw URL get a synthetic `url.<host>.<path>` identifier (see the server
 * skill importer), not a marketplace slug — the caller disables the sync for
 * those instead of letting the market detail lookup 404 and retry.
 */
export const skillDetailResource = defineReplica<SkillDetailParams, DiscoverSkillDetail>({
  fetcher: (params) =>
    discoverService.getSkillDetail({ identifier: params.identifier, version: params.version }),
  key: skillDetailQueryKey,
  name: 'skillDetail',
  storage: 'indexedDB',
  version: 1,
});

// ============================== Categories ==============================

/** Category counts of the community skill sidebar (the search term). */
export type SkillCategoriesParams = CategoryListQuery;

/** Entry key of one category-counts query (search term + locale). */
export const skillCategoriesQueryKey = (params: SkillCategoriesParams): string =>
  stableQueryKey(params);

/**
 * Category counts of one query (`skillCategoriesMap[key]`). Small and read on
 * almost every community skill screen, so localStorage keeps the first frame
 * populated instead of flashing an empty sidebar.
 */
export const skillCategoriesResource = defineReplica<SkillCategoriesParams, SkillCategoryItem[]>({
  fetcher: (params) => discoverService.getSkillCategories(params),
  key: skillCategoriesQueryKey,
  name: 'skillCategories',
  storage: 'localStorage',
  version: 1,
});

// ============================== Comments ==============================

/** Comment list query of one skill (`identifier` + paging / sort). */
export type SkillCommentsParams = SkillCommentsQueryParams;

/** Entry key of one comment page (`identifier`, sort, page). */
export const skillCommentsQueryKey = (params: SkillCommentsParams): string =>
  stableQueryKey(params);

/**
 * Comments of one skill, one entry per page (`skillCommentsMap[key]`). The
 * detail header reads the first page and the Reviews tab reuses the same entry,
 * so the stat and the list cost one request.
 */
export const skillCommentsResource = defineReplica<SkillCommentsParams, SkillCommentListResponse>({
  fetcher: (params) => discoverService.getSkillComments(params),
  key: skillCommentsQueryKey,
  name: 'skillComments',
  storage: 'indexedDB',
  version: 1,
});

// ============================== Rating distribution ==============================

export interface SkillRatingDistributionParams {
  identifier: string;
}

/** Entry key of one skill's rating distribution. */
export const skillRatingDistributionQueryKey = (params: SkillRatingDistributionParams): string =>
  stableQueryKey(params);

/** Rating distribution of one skill (`skillRatingDistributionMap[key]`). */
export const skillRatingDistributionResource = defineReplica<
  SkillRatingDistributionParams,
  SkillRatingDistribution
>({
  fetcher: (params) => discoverService.getSkillRatingDistribution(params.identifier),
  key: skillRatingDistributionQueryKey,
  name: 'skillRatingDistribution',
  storage: 'localStorage',
  version: 1,
});

// ============================== Related ==============================

export interface SkillRelatedParams {
  category: string;
  identifier: string;
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale?: string;
}

/** Entry key of one related-skills query (`category`, identifier, locale). */
export const skillRelatedQueryKey = (params: SkillRelatedParams): string => stableQueryKey(params);

/**
 * Related skills for the detail view (`skillRelatedMap[key]`), composed
 * client-side from the list endpoint. Kept out of `getSkillDetail` on purpose:
 * that query also backs per-skill icon/metadata lookups (one per installed
 * skill in the chat tools panel), which must not pay for an extra upstream list
 * request. One extra row is fetched so the cap still holds after dropping the
 * skill itself.
 */
export const skillRelatedResource = defineReplica<SkillRelatedParams, DiscoverSkillItem[]>({
  fetcher: async (params) => {
    const list = await discoverService.getSkillList({
      category: params.category,
      page: 1,
      pageSize: RELATED_SKILLS_COUNT + 1,
      sort: SkillSorts.Recommended,
    });
    return list.items
      .filter((item) => item.identifier !== params.identifier)
      .slice(0, RELATED_SKILLS_COUNT);
  },
  key: skillRelatedQueryKey,
  name: 'skillRelated',
  storage: 'localStorage',
  version: 1,
});
