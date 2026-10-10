import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
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
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';

import {
  type SkillCategoriesParams,
  skillCategoriesQueryKey,
  skillCategoriesResource,
  type SkillCommentsParams,
  skillCommentsQueryKey,
  skillCommentsResource,
  type SkillDetailParams,
  skillDetailQueryKey,
  skillDetailResource,
  type SkillListParams,
  skillListQueryKey,
  skillListResource,
  type SkillRatingDistributionParams,
  skillRatingDistributionQueryKey,
  skillRatingDistributionResource,
  type SkillRelatedParams,
  skillRelatedQueryKey,
  skillRelatedResource,
} from './projection';

const n = setNamespace('discover/skill');

/**
 * Sync flags of a market read, plus the aliases the old SWR hooks returned
 * (`isLoading` / `mutate`) so a call site only has to move its `data` read to
 * the matching `skillSelectors` entry.
 */
export interface SkillSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the value with `skillSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<DiscoverStore>;

export const createSkillSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new SkillActionImpl(set, get, _api);

export class SkillActionImpl {
  readonly #categories;
  readonly #comments;
  readonly #detail;
  readonly #get: () => DiscoverStore;
  readonly #list;
  readonly #ratingDistribution;
  readonly #related;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(skillListResource, {
      actionPrefix: n('list'),
      get,
      set,
      stateKey: 'skillListReplica',
      view: recordLens<DiscoverStore, SkillListResponse>('skillListMap'),
    });
    this.#detail = createReplicaSlice(skillDetailResource, {
      actionPrefix: n('detail'),
      get,
      set,
      stateKey: 'skillDetailReplica',
      view: recordLens<DiscoverStore, DiscoverSkillDetail>('skillDetailMap'),
    });
    this.#categories = createReplicaSlice(skillCategoriesResource, {
      actionPrefix: n('categories'),
      get,
      set,
      stateKey: 'skillCategoriesReplica',
      view: recordLens<DiscoverStore, SkillCategoryItem[]>('skillCategoriesMap'),
    });
    this.#comments = createReplicaSlice(skillCommentsResource, {
      actionPrefix: n('comments'),
      get,
      set,
      stateKey: 'skillCommentsReplica',
      view: recordLens<DiscoverStore, SkillCommentListResponse>('skillCommentsMap'),
    });
    this.#ratingDistribution = createReplicaSlice(skillRatingDistributionResource, {
      actionPrefix: n('ratingDistribution'),
      get,
      set,
      stateKey: 'skillRatingDistributionReplica',
      view: recordLens<DiscoverStore, SkillRatingDistribution>('skillRatingDistributionMap'),
    });
    this.#related = createReplicaSlice(skillRelatedResource, {
      actionPrefix: n('related'),
      get,
      set,
      stateKey: 'skillRelatedReplica',
      view: recordLens<DiscoverStore, DiscoverSkillItem[]>('skillRelatedMap'),
    });
  }

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
    active: boolean,
  ): SkillSyncResult => ({
    ...sync,
    // A disabled hook never loads; a settled entry with a value never flashes.
    isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
    mutate: sync.revalidate,
    queryKey: active ? queryKey : undefined,
  });

  /**
   * The skill market list of one query. Each (filters · page) pair is its own
   * entry, so the URL-driven pager walks entries instead of appending pages.
   * Read the rows with `skillSelectors.skillList(queryKey)`.
   */
  useFetchSkillList = (
    params: SkillQueryParams = {},
    options: { enabled?: boolean } = {},
  ): SkillSyncResult => {
    const { enabled = true } = options;
    const normalized: SkillListParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    };
    const queryKey = skillListQueryKey(normalized);
    const sync = this.#list.useSync(normalized, { enabled });
    return this.#toSyncResult(sync, queryKey, !!this.#get().skillListMap[queryKey], enabled);
  };

  /**
   * One skill detail by identifier (optionally pinned to a version). Read it
   * with `skillSelectors.skillDetail(queryKey)`; `undefined` after the sync
   * settles means the market has no such identifier.
   *
   * Skills imported from a raw URL carry a synthetic `url.<host>.<path>`
   * identifier that the market detail endpoint can only 404 — the sync is
   * disabled for those and callers fall back to the locally stored metadata.
   */
  useFetchSkillDetail = (
    params: { identifier?: string; version?: string },
    options: { enabled?: boolean } = {},
  ): SkillSyncResult => {
    const { enabled = true } = options;
    const identifier = params.identifier;
    const isMarketIdentifier = !!identifier && !identifier.startsWith('url.');
    const normalized: SkillDetailParams = {
      identifier: identifier ?? '',
      locale: globalHelpers.getCurrentLanguage(),
      version: params.version,
    };
    const queryKey = skillDetailQueryKey(normalized);
    const active = enabled && isMarketIdentifier;
    const sync = this.#detail.useSync(active ? normalized : null, { enabled: active });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().skillDetailMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Category counts of one query (the search term). The community sidebar reads
   * `skillSelectors.skillCategories(queryKey)`.
   */
  useSkillCategories = (
    params: SkillCategoriesParams = {},
    options: { enabled?: boolean } = {},
  ): SkillSyncResult => {
    const { enabled = true } = options;
    const normalized: SkillCategoriesParams = {
      ...params,
      locale: globalHelpers.getCurrentLanguage(),
    };
    const queryKey = skillCategoriesQueryKey(normalized);
    const sync = this.#categories.useSync(normalized, { enabled, revalidateOnFocus: false });
    return this.#toSyncResult(sync, queryKey, !!this.#get().skillCategoriesMap[queryKey], enabled);
  };

  /**
   * Comments of one skill. The header stat and the Reviews tab pass the same
   * params, so they share one entry. Read them with
   * `skillSelectors.skillComments(queryKey)`.
   */
  useFetchSkillComments = (
    params: Partial<SkillCommentsQueryParams>,
    options: { enabled?: boolean } = {},
  ): SkillSyncResult => {
    const { enabled = true } = options;
    const identifier = params.identifier;
    const normalized: SkillCommentsParams = {
      ...params,
      identifier: identifier ?? '',
    } as SkillCommentsParams;
    const queryKey = skillCommentsQueryKey(normalized);
    const active = enabled && !!identifier;
    const sync = this.#comments.useSync(active ? normalized : null, { enabled: active });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().skillCommentsMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Rating distribution of one skill. Read it with
   * `skillSelectors.skillRatingDistribution(queryKey)`.
   */
  useFetchSkillRatingDistribution = (
    identifier?: string,
    options: { enabled?: boolean } = {},
  ): SkillSyncResult => {
    const { enabled = true } = options;
    const normalized: SkillRatingDistributionParams = { identifier: identifier ?? '' };
    const queryKey = skillRatingDistributionQueryKey(normalized);
    const active = enabled && !!identifier;
    const sync = this.#ratingDistribution.useSync(active ? normalized : null, { enabled: active });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().skillRatingDistributionMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Related skills for the detail view. Needs both the category and the
   * identifier; without them the sync is disabled and the selector is empty.
   * Read them with `skillSelectors.skillRelated(queryKey)`.
   */
  useFetchRelatedSkills = (
    params: { category?: string; identifier?: string },
    options: { enabled?: boolean } = {},
  ): SkillSyncResult => {
    const { enabled = true } = options;
    const { category, identifier } = params;
    const normalized: SkillRelatedParams = {
      category: category ?? '',
      identifier: identifier ?? '',
      locale: globalHelpers.getCurrentLanguage(),
    };
    const queryKey = skillRelatedQueryKey(normalized);
    const active = enabled && !!category && !!identifier;
    const sync = this.#related.useSync(active ? normalized : null, { enabled: active });
    return this.#toSyncResult(
      sync,
      queryKey,
      this.#get().skillRelatedMap[queryKey] !== undefined,
      active,
    );
  };
}

export type SkillAction = Pick<SkillActionImpl, keyof SkillActionImpl>;
