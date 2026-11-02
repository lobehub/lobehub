import type {
  LayersEnum,
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  SearchMemoryParams,
  UserMemoryIdentityWithoutVectors,
} from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';

import type {
  FtsSearchBackendEntity,
  FtsSearchBackendFilters,
  FtsSearchCandidateSource,
} from '../../../repositories/ftsSearch';
import type {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { buildUserMemoryWhere } from '../where';
import type { UserMemoryQueryContext } from './context';
import { buildCandidateFilters, fetchFtsSearchCandidates } from './ftsCandidates';
import {
  searchHybridActivities,
  searchHybridContexts,
  searchHybridExperiences,
  searchHybridIdentities,
  searchHybridPreferences,
} from './hybrid';
import {
  searchActivitiesLexical,
  searchContextsLexical,
  searchExperiencesLexical,
  searchIdentitiesLexical,
  searchPreferencesLexical,
} from './lexical';
import {
  buildExactTagFilterCondition,
  buildTimeRangeCondition,
  collectCandidateMemoryIds,
  getSearchLimit,
  getSearchOverfetchLimit,
  hasSearchFilters,
  loadBaseSignals,
  shouldRunSemanticSearch,
  toSearchTags,
} from './searchFilters';
import { searchMemory } from './searchMemory';
import {
  searchActivitiesSemantic,
  searchContextsSemantic,
  searchExperiencesSemantic,
  searchIdentitiesSemantic,
  searchPreferencesSemantic,
} from './semantic';
import type { LayerScalarAggregationConfig } from './taxonomy';
import {
  aggregateBaseArrayOptions,
  aggregateBaseMemoryOptions,
  aggregateIdentityValueOptions,
  aggregateLayerArrayValues,
  aggregateLayerLabels,
  aggregateLayerTypes,
  aggregateScalarLayerValues,
  aggregateStatuses,
  aggregateTypedLayerValues,
  queryTaxonomyOptions,
} from './taxonomy';
import type { SearchLayerKey, UserMemoryHybridSearchAggregatedResult } from './types';

export { buildBm25MatchCondition } from './lexical';
export { scoreHybridCandidates } from './scoring';
export type {
  Bm25MatchFieldGroup,
  LayerBaseMemorySignals,
  RankedSearchCandidate,
  RecommendationScoreBreakdown,
  SearchLayerKey,
  UserMemoryHybridSearchAggregatedResult,
} from './types';
export {
  normalizeUserMemorySearchQueries,
  shouldRunUserMemoryLexicalSearch,
  USER_MEMORY_LEXICAL_QUERY_CHARACTER_LIMIT,
} from './utils';

export class UserMemoryQueryModel {
  private readonly context: UserMemoryQueryContext;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly ftsSearchCandidateSource?: FtsSearchCandidateSource,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const model = this;
    this.context = {
      get db() {
        return model.db;
      },
      get ftsSearchCandidateSource() {
        return model.ftsSearchCandidateSource;
      },
      memoryWhere: (table) => this.memoryWhere(table),
      get userId() {
        return model.userId;
      },
      aggregateBaseArrayOptions: (...args) => this.aggregateBaseArrayOptions(...args),
      aggregateBaseMemoryOptions: (...args) => this.aggregateBaseMemoryOptions(...args),
      aggregateIdentityValueOptions: (...args) => this.aggregateIdentityValueOptions(...args),
      aggregateLayerArrayValues: (...args) => this.aggregateLayerArrayValues(...args),
      aggregateLayerLabels: (...args) => this.aggregateLayerLabels(...args),
      aggregateLayerTypes: (...args) => this.aggregateLayerTypes(...args),
      aggregateScalarLayerValues: (...args) => this.aggregateScalarLayerValues(...args),
      aggregateStatuses: (...args) => this.aggregateStatuses(...args),
      aggregateTypedLayerValues: (...args) => this.aggregateTypedLayerValues(...args),
      buildCandidateFilters: (...args) => this.buildCandidateFilters(...args),
      buildExactTagFilterCondition: (...args) => this.buildExactTagFilterCondition(...args),
      buildTimeRangeCondition: (...args) => this.buildTimeRangeCondition(...args),
      collectCandidateMemoryIds: (...args) => this.collectCandidateMemoryIds(...args),
      fetchFtsSearchCandidates: (...args) => this.fetchFtsSearchCandidates(...args),
      getSearchLimit: (...args) => this.getSearchLimit(...args),
      getSearchOverfetchLimit: (...args) => this.getSearchOverfetchLimit(...args),
      hasSearchFilters: (...args) => this.hasSearchFilters(...args),
      loadBaseSignals: (...args) => this.loadBaseSignals(...args),
      searchActivitiesLexical: (...args) => this.searchActivitiesLexical(...args),
      searchActivitiesSemantic: (...args) => this.searchActivitiesSemantic(...args),
      searchContextsLexical: (...args) => this.searchContextsLexical(...args),
      searchContextsSemantic: (...args) => this.searchContextsSemantic(...args),
      searchExperiencesLexical: (...args) => this.searchExperiencesLexical(...args),
      searchExperiencesSemantic: (...args) => this.searchExperiencesSemantic(...args),
      searchHybridActivities: (...args) => this.searchHybridActivities(...args),
      searchHybridContexts: (...args) => this.searchHybridContexts(...args),
      searchHybridExperiences: (...args) => this.searchHybridExperiences(...args),
      searchHybridIdentities: (...args) => this.searchHybridIdentities(...args),
      searchHybridPreferences: (...args) => this.searchHybridPreferences(...args),
      searchIdentitiesLexical: (...args) => this.searchIdentitiesLexical(...args),
      searchIdentitiesSemantic: (...args) => this.searchIdentitiesSemantic(...args),
      searchPreferencesLexical: (...args) => this.searchPreferencesLexical(...args),
      searchPreferencesSemantic: (...args) => this.searchPreferencesSemantic(...args),
      shouldRunSemanticSearch: (...args) => this.shouldRunSemanticSearch(...args),
      toSearchTags: (...args) => this.toSearchTags(...args),
    };
  }

  private memoryWhere(table: Parameters<typeof buildUserMemoryWhere>[2]) {
    return buildUserMemoryWhere(this.db, this.userId, table);
  }

  private buildCandidateFilters(
    entity: FtsSearchBackendEntity,
    params: SearchMemoryParams,
  ): FtsSearchBackendFilters {
    return buildCandidateFilters(this.context, entity, params);
  }

  private async fetchFtsSearchCandidates(params: {
    entity: FtsSearchBackendEntity;
    fields: string[];
    limit: number;
    query: string;
    searchParams: SearchMemoryParams;
  }) {
    return fetchFtsSearchCandidates(this.context, params);
  }

  searchMemory = async (
    params: SearchMemoryParams,
    queryEmbeddings: number[][] = [],
  ): Promise<UserMemoryHybridSearchAggregatedResult> => {
    return searchMemory(this.context, params, queryEmbeddings);
  };

  queryTaxonomyOptions = async (
    params: QueryTaxonomyOptionsParams = {},
  ): Promise<QueryTaxonomyOptionsResult> => {
    return queryTaxonomyOptions(this.context, params);
  };

  private getSearchLimit(key: SearchLayerKey, params: SearchMemoryParams) {
    return getSearchLimit(key, params);
  }

  private getSearchOverfetchLimit(key: SearchLayerKey, params: SearchMemoryParams) {
    return getSearchOverfetchLimit(this.context, key, params);
  }

  private buildTimeRangeCondition(
    fieldMap: Partial<
      Record<
        'capturedAt' | 'createdAt' | 'endsAt' | 'episodicDate' | 'startsAt' | 'updatedAt',
        AnyColumn
      >
    >,
    timeRange?: SearchMemoryParams['timeRange'],
  ): SQL | undefined {
    return buildTimeRangeCondition(fieldMap, timeRange);
  }

  private collectCandidateMemoryIds(item: {
    userMemoryId?: string | null;
    userMemoryIds?: string[] | null;
  }) {
    return collectCandidateMemoryIds(item);
  }

  private async loadBaseSignals<
    T extends { id: string; userMemoryId?: string | null; userMemoryIds?: string[] | null },
  >(items: T[]) {
    return loadBaseSignals(this.context, items);
  }

  private hasSearchFilters(params: SearchMemoryParams) {
    return hasSearchFilters(params);
  }

  private shouldRunSemanticSearch(queryCount: number, embeddingsCount: number) {
    return shouldRunSemanticSearch(queryCount, embeddingsCount);
  }

  private toSearchTags(params: SearchMemoryParams) {
    return toSearchTags(params);
  }

  private buildExactTagFilterCondition(
    layerTags: AnyColumn,
    baseTags: AnyColumn,
    params: SearchMemoryParams,
  ) {
    return buildExactTagFilterCondition(this.context, layerTags, baseTags, params);
  }

  private async aggregateBaseMemoryOptions(params: {
    column: typeof userMemories.memoryCategory | typeof userMemories.memoryType;
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['categories']> {
    return aggregateBaseMemoryOptions(this.context, params);
  }

  private async aggregateBaseArrayOptions(params: {
    column: typeof userMemories.tags;
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['tags']> {
    return aggregateBaseArrayOptions(this.context, params);
  }

  private async aggregateLayerArrayValues(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }) {
    return aggregateLayerArrayValues(this.context, params);
  }

  private async aggregateLayerLabels(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['labels']> {
    return aggregateLayerLabels(this.context, params);
  }

  private async aggregateTypedLayerValues(params: {
    column: AnyColumn;
    layer: LayersEnum;
    limit: number;
    q?: string;
    table:
      | typeof userMemoriesActivities
      | typeof userMemoriesContexts
      | typeof userMemoriesExperiences
      | typeof userMemoriesIdentities
      | typeof userMemoriesPreferences;
    timeRange?: SearchMemoryParams['timeRange'];
    timeRangeColumns: Partial<
      Record<
        'capturedAt' | 'createdAt' | 'endsAt' | 'episodicDate' | 'startsAt' | 'updatedAt',
        AnyColumn
      >
    >;
    userIdColumn: AnyColumn;
  }) {
    return aggregateTypedLayerValues(this.context, params);
  }

  private async aggregateScalarLayerValues(params: {
    configs: LayerScalarAggregationConfig[];
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }) {
    return aggregateScalarLayerValues(this.context, params);
  }

  private async aggregateLayerTypes(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['types']> {
    return aggregateLayerTypes(this.context, params);
  }

  private async aggregateStatuses(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['statuses']> {
    return aggregateStatuses(this.context, params);
  }

  private async aggregateIdentityValueOptions(params: {
    column: typeof userMemoriesIdentities.relationship | typeof userMemoriesIdentities.role;
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['relationships']> {
    return aggregateIdentityValueOptions(this.context, params);
  }

  private async searchHybridActivities(params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  }) {
    return searchHybridActivities(this.context, params);
  }

  private async searchHybridContexts(params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  }) {
    return searchHybridContexts(this.context, params);
  }

  private async searchHybridExperiences(params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  }) {
    return searchHybridExperiences(this.context, params);
  }

  private async searchHybridIdentities(params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  }) {
    return searchHybridIdentities(this.context, params);
  }

  private async searchHybridPreferences(params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  }) {
    return searchHybridPreferences(this.context, params);
  }

  private async searchActivitiesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchActivitiesSemantic(this.context, embedding, limit, params);
  }

  private async searchContextsSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchContextsSemantic(this.context, embedding, limit, params);
  }

  private async searchExperiencesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchExperiencesSemantic(this.context, embedding, limit, params);
  }

  private async searchPreferencesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchPreferencesSemantic(this.context, embedding, limit, params);
  }

  private async searchIdentitiesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ): Promise<UserMemoryIdentityWithoutVectors[]> {
    return searchIdentitiesSemantic(this.context, embedding, limit, params);
  }

  private async searchActivitiesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchActivitiesLexical(this.context, query, limit, params);
  }

  private async searchContextsLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchContextsLexical(this.context, query, limit, params);
  }

  private async searchExperiencesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchExperiencesLexical(this.context, query, limit, params);
  }

  private async searchPreferencesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchPreferencesLexical(this.context, query, limit, params);
  }

  private async searchIdentitiesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    return searchIdentitiesLexical(this.context, query, limit, params);
  }
}
