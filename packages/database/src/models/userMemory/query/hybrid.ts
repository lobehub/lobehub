import type { SearchMemoryParams } from '@lobechat/types';

import type { UserMemoryQueryContext } from './context';
import { scoreHybridCandidates } from './scoring';
import { buildRetrievalQuery, combineEmbeddings } from './utils';

export async function searchHybridActivities(
  ctx: UserMemoryQueryContext,
  params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  },
) {
  const limit = ctx.getSearchOverfetchLimit('activities', params.params);
  if (limit <= 0) return [];

  const semanticEmbedding = combineEmbeddings(params.embeddings);
  const semanticLists =
    semanticEmbedding &&
    ctx.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
      ? [await ctx.searchActivitiesSemantic(semanticEmbedding, limit, params.params)]
      : [];
  const retrievalQuery = buildRetrievalQuery(params.queries);
  const lexicalLists =
    params.lexicalSearch && (retrievalQuery || ctx.hasSearchFilters(params.params))
      ? [await ctx.searchActivitiesLexical(retrievalQuery, limit, params.params)]
      : [];

  const items = [
    ...new Map(
      [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
    ).values(),
  ];

  return scoreHybridCandidates({
    baseSignals: await ctx.loadBaseSignals(items),
    items,
    lexicalLists,
    queries: params.queries,
    queryParams: params.params,
    semanticLists,
  });
}

export async function searchHybridContexts(
  ctx: UserMemoryQueryContext,
  params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  },
) {
  const limit = ctx.getSearchOverfetchLimit('contexts', params.params);
  if (limit <= 0) return [];

  const semanticEmbedding = combineEmbeddings(params.embeddings);
  const semanticLists =
    semanticEmbedding &&
    ctx.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
      ? [await ctx.searchContextsSemantic(semanticEmbedding, limit, params.params)]
      : [];
  const retrievalQuery = buildRetrievalQuery(params.queries);
  const lexicalLists =
    params.lexicalSearch && (retrievalQuery || ctx.hasSearchFilters(params.params))
      ? [await ctx.searchContextsLexical(retrievalQuery, limit, params.params)]
      : [];

  const items = [
    ...new Map(
      [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
    ).values(),
  ];

  return scoreHybridCandidates({
    baseSignals: await ctx.loadBaseSignals(items),
    items,
    lexicalLists,
    queries: params.queries,
    queryParams: params.params,
    semanticLists,
  });
}

export async function searchHybridExperiences(
  ctx: UserMemoryQueryContext,
  params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  },
) {
  const limit = ctx.getSearchOverfetchLimit('experiences', params.params);
  if (limit <= 0) return [];

  const semanticEmbedding = combineEmbeddings(params.embeddings);
  const semanticLists =
    semanticEmbedding &&
    ctx.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
      ? [await ctx.searchExperiencesSemantic(semanticEmbedding, limit, params.params)]
      : [];
  const retrievalQuery = buildRetrievalQuery(params.queries);
  const lexicalLists =
    params.lexicalSearch && (retrievalQuery || ctx.hasSearchFilters(params.params))
      ? [await ctx.searchExperiencesLexical(retrievalQuery, limit, params.params)]
      : [];

  const items = [
    ...new Map(
      [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
    ).values(),
  ];

  return scoreHybridCandidates({
    baseSignals: await ctx.loadBaseSignals(items),
    items,
    lexicalLists,
    queries: params.queries,
    queryParams: params.params,
    semanticLists,
  });
}

export async function searchHybridIdentities(
  ctx: UserMemoryQueryContext,
  params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  },
) {
  const limit = ctx.getSearchOverfetchLimit('identities', params.params);
  if (limit <= 0) return [];

  const semanticEmbedding = combineEmbeddings(params.embeddings);
  const semanticLists =
    semanticEmbedding &&
    ctx.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
      ? [await ctx.searchIdentitiesSemantic(semanticEmbedding, limit, params.params)]
      : [];
  const retrievalQuery = buildRetrievalQuery(params.queries);
  const lexicalLists =
    params.lexicalSearch && (retrievalQuery || ctx.hasSearchFilters(params.params))
      ? [await ctx.searchIdentitiesLexical(retrievalQuery, limit, params.params)]
      : [];

  const items = [
    ...new Map(
      [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
    ).values(),
  ];

  return scoreHybridCandidates({
    baseSignals: await ctx.loadBaseSignals(items),
    items,
    lexicalLists,
    queries: params.queries,
    queryParams: params.params,
    semanticLists,
  });
}

export async function searchHybridPreferences(
  ctx: UserMemoryQueryContext,
  params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: SearchMemoryParams;
    queries: string[];
  },
) {
  const limit = ctx.getSearchOverfetchLimit('preferences', params.params);
  if (limit <= 0) return [];

  const semanticEmbedding = combineEmbeddings(params.embeddings);
  const semanticLists =
    semanticEmbedding &&
    ctx.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
      ? [await ctx.searchPreferencesSemantic(semanticEmbedding, limit, params.params)]
      : [];
  const retrievalQuery = buildRetrievalQuery(params.queries);
  const lexicalLists =
    params.lexicalSearch && (retrievalQuery || ctx.hasSearchFilters(params.params))
      ? [await ctx.searchPreferencesLexical(retrievalQuery, limit, params.params)]
      : [];

  const items = [
    ...new Map(
      [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
    ).values(),
  ];

  return scoreHybridCandidates({
    baseSignals: await ctx.loadBaseSignals(items),
    items,
    lexicalLists,
    queries: params.queries,
    queryParams: params.params,
    semanticLists,
  });
}
