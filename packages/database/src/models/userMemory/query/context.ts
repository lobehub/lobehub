import type { FtsSearchCandidateSource } from '../../../repositories/ftsSearch';
import type { LobeChatDatabase } from '../../../type';
import type { buildUserMemoryWhere } from '../where';
import type { buildCandidateFilters, fetchFtsSearchCandidates } from './ftsCandidates';
import type {
  searchHybridActivities,
  searchHybridContexts,
  searchHybridExperiences,
  searchHybridIdentities,
  searchHybridPreferences,
} from './hybrid';
import type {
  searchActivitiesLexical,
  searchContextsLexical,
  searchExperiencesLexical,
  searchIdentitiesLexical,
  searchPreferencesLexical,
} from './lexical';
import type {
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
import type {
  searchActivitiesSemantic,
  searchContextsSemantic,
  searchExperiencesSemantic,
  searchIdentitiesSemantic,
  searchPreferencesSemantic,
} from './semantic';
import type {
  aggregateBaseArrayOptions,
  aggregateBaseMemoryOptions,
  aggregateIdentityValueOptions,
  aggregateLayerArrayValues,
  aggregateLayerLabels,
  aggregateLayerTypes,
  aggregateScalarLayerValues,
  aggregateStatuses,
  aggregateTypedLayerValues,
} from './taxonomy';

type OmitContext<F> = F extends (ctx: UserMemoryQueryContext, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;

/**
 * What the extracted `UserMemoryQueryModel` modules read from the model. Collaborators are getters
 * and methods dispatch through the instance, so spies on the model's retrieval methods still apply.
 */
export interface UserMemoryQueryContext {
  aggregateBaseArrayOptions: OmitContext<typeof aggregateBaseArrayOptions>;
  aggregateBaseMemoryOptions: OmitContext<typeof aggregateBaseMemoryOptions>;
  aggregateIdentityValueOptions: OmitContext<typeof aggregateIdentityValueOptions>;
  aggregateLayerArrayValues: OmitContext<typeof aggregateLayerArrayValues>;
  aggregateLayerLabels: OmitContext<typeof aggregateLayerLabels>;
  aggregateLayerTypes: OmitContext<typeof aggregateLayerTypes>;
  aggregateScalarLayerValues: OmitContext<typeof aggregateScalarLayerValues>;
  aggregateStatuses: OmitContext<typeof aggregateStatuses>;
  aggregateTypedLayerValues: OmitContext<typeof aggregateTypedLayerValues>;
  buildCandidateFilters: OmitContext<typeof buildCandidateFilters>;
  buildExactTagFilterCondition: OmitContext<typeof buildExactTagFilterCondition>;
  buildTimeRangeCondition: typeof buildTimeRangeCondition;
  collectCandidateMemoryIds: typeof collectCandidateMemoryIds;
  readonly db: LobeChatDatabase;
  fetchFtsSearchCandidates: OmitContext<typeof fetchFtsSearchCandidates>;
  readonly ftsSearchCandidateSource?: FtsSearchCandidateSource;
  getSearchLimit: typeof getSearchLimit;
  getSearchOverfetchLimit: OmitContext<typeof getSearchOverfetchLimit>;
  hasSearchFilters: typeof hasSearchFilters;
  loadBaseSignals: OmitContext<typeof loadBaseSignals>;
  memoryWhere: (
    table: Parameters<typeof buildUserMemoryWhere>[2],
  ) => ReturnType<typeof buildUserMemoryWhere>;
  searchActivitiesLexical: OmitContext<typeof searchActivitiesLexical>;
  searchActivitiesSemantic: OmitContext<typeof searchActivitiesSemantic>;
  searchContextsLexical: OmitContext<typeof searchContextsLexical>;
  searchContextsSemantic: OmitContext<typeof searchContextsSemantic>;
  searchExperiencesLexical: OmitContext<typeof searchExperiencesLexical>;
  searchExperiencesSemantic: OmitContext<typeof searchExperiencesSemantic>;
  searchHybridActivities: OmitContext<typeof searchHybridActivities>;
  searchHybridContexts: OmitContext<typeof searchHybridContexts>;
  searchHybridExperiences: OmitContext<typeof searchHybridExperiences>;
  searchHybridIdentities: OmitContext<typeof searchHybridIdentities>;
  searchHybridPreferences: OmitContext<typeof searchHybridPreferences>;
  searchIdentitiesLexical: OmitContext<typeof searchIdentitiesLexical>;
  searchIdentitiesSemantic: OmitContext<typeof searchIdentitiesSemantic>;
  searchPreferencesLexical: OmitContext<typeof searchPreferencesLexical>;
  searchPreferencesSemantic: OmitContext<typeof searchPreferencesSemantic>;
  shouldRunSemanticSearch: typeof shouldRunSemanticSearch;
  toSearchTags: typeof toSearchTags;
  readonly userId: string;
}
