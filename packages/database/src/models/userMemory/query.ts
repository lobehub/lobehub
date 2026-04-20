import type {
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  SearchMemoryParams,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';

import type {
  UserMemoryActivitiesWithoutVectors,
  UserMemoryContextsWithoutVectors,
  UserMemoryExperiencesWithoutVectors,
  UserMemoryIdentitiesWithoutVectors,
  UserMemoryPreferencesWithoutVectors,
} from '../../schemas';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SAFE_BM25_QUERY_OPTIONS, sanitizeBm25Query } from '../../utils/bm25';

const DEFAULT_HYBRID_SEARCH_LIMIT = 5;
const HYBRID_SEARCH_OVERFETCH_MULTIPLIER = 3;
const DEFAULT_TAXONOMY_LIMIT = 20;
const DEFAULT_TEMPORAL_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;
const SHORT_TERM_ASSOCIATION_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;

export type SearchLayerKey =
  | 'activities'
  | 'contexts'
  | 'experiences'
  | 'identities'
  | 'preferences';

interface HybridLayerLimitRecord {
  activities?: number;
  contexts?: number;
  experiences?: number;
  identities?: number;
  preferences?: number;
}

interface HybridSearchLayerMeta {
  hasMore: boolean;
  returned: number;
  total: number;
}

export interface LayerBaseMemorySignals {
  categories: string[];
  memoryIds: string[];
  tags: string[];
  times: number[];
}

export interface RecommendationScoreBreakdown {
  categoryAffinity: number;
  clusterBoost: number;
  final: number;
  fuzzy: number;
  keyword: number;
  semantic: number;
  tagAffinity: number;
  temporal: number;
}

export interface RankedSearchCandidate<T> {
  item: T;
  score: RecommendationScoreBreakdown;
}

export interface UserMemoryHybridSearchAggregatedResult {
  activities: UserMemoryActivitiesWithoutVectors[];
  contexts: UserMemoryContextsWithoutVectors[];
  experiences: UserMemoryExperiencesWithoutVectors[];
  identities: UserMemoryIdentitiesWithoutVectors[];
  meta: {
    appliedFilters: Omit<SearchMemoryParams, 'effort' | 'topK'>;
    appliedQueries: string[];
    layers: Record<SearchLayerKey, HybridSearchLayerMeta>;
    ranking: Partial<Record<SearchLayerKey, Record<string, RecommendationScoreBreakdown>>>;
  };
  preferences: UserMemoryPreferencesWithoutVectors[];
}

interface TaxonomyOptionAccumulator {
  count: number;
  layers: Set<LayersEnum>;
}

interface LayerArrayAggregationConfig {
  column: AnyColumn;
  cteName: string;
  layer: LayersEnum;
  table:
    | typeof userMemoriesActivities
    | typeof userMemoriesContexts
    | typeof userMemoriesExperiences
    | typeof userMemoriesIdentities
    | typeof userMemoriesPreferences;
  timeRangeColumns: Partial<
    Record<
      'capturedAt' | 'createdAt' | 'endsAt' | 'episodicDate' | 'startsAt' | 'updatedAt',
      AnyColumn
    >
  >;
  userIdColumn: AnyColumn;
}

interface LayerScalarAggregationConfig {
  column: AnyColumn;
  layer: LayersEnum;
  table:
    | typeof userMemoriesActivities
    | typeof userMemoriesContexts
    | typeof userMemoriesExperiences
    | typeof userMemoriesIdentities
    | typeof userMemoriesPreferences;
  timeRangeColumns: Partial<
    Record<
      'capturedAt' | 'createdAt' | 'endsAt' | 'episodicDate' | 'startsAt' | 'updatedAt',
      AnyColumn
    >
  >;
  userIdColumn: AnyColumn;
}

const normalizeSearchQueries = (queries?: string[]): string[] => {
  if (!queries) return [];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
};

const buildRetrievalQuery = (queries: string[]) => {
  if (queries.length === 0) return undefined;

  return queries.join(' ');
};

const combineEmbeddings = (embeddings: number[][]) => {
  if (embeddings.length === 0) return undefined;
  if (embeddings.length === 1) return embeddings[0];

  const [firstEmbedding] = embeddings;
  if (!firstEmbedding || firstEmbedding.length === 0) return undefined;

  return firstEmbedding.map((_, index) => {
    const sum = embeddings.reduce(
      (accumulator, embedding) => accumulator + (embedding[index] ?? 0),
      0,
    );

    return sum / embeddings.length;
  });
};

const normalizeSimilarityTerm = (value: string) => value.trim().toLowerCase();

const normalizeSearchTerms = (values?: string[]) => [
  ...new Set((values ?? []).map((value) => normalizeSimilarityTerm(value)).filter(Boolean)),
];

const clampScore = (value: number) => Math.max(0, Math.min(1, value));

const reciprocalRankScore = (rank?: number) => (rank === undefined ? 0 : 1 / (rank + 1));

const tokenizeSimilarityTerm = (value: string) =>
  normalizeSimilarityTerm(value)
    .split(/[\s\-_/]+/)
    .filter(Boolean);

const computeTokenJaccard = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) return 0;

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union === 0 ? 0 : intersection / union;
};

const computeTermSimilarity = (left: string, right: string) => {
  const normalizedLeft = normalizeSimilarityTerm(left);
  const normalizedRight = normalizeSimilarityTerm(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.85;
  }

  return computeTokenJaccard(
    tokenizeSimilarityTerm(normalizedLeft),
    tokenizeSimilarityTerm(normalizedRight),
  );
};

const computeArraySimilarity = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) return 0;

  return left.reduce((maxScore, leftValue) => {
    return Math.max(
      maxScore,
      right.reduce(
        (innerMax, rightValue) => Math.max(innerMax, computeTermSimilarity(leftValue, rightValue)),
        0,
      ),
    );
  }, 0);
};

const scoreTimeDistance = (distanceMs: number, windowMs: number) => {
  if (!Number.isFinite(distanceMs)) return 0;
  if (distanceMs <= 0) return 1;

  return clampScore(Math.exp(-distanceMs / Math.max(windowMs, 1)));
};

const createEmptySearchLayerMeta = (): Record<SearchLayerKey, HybridSearchLayerMeta> => ({
  activities: { hasMore: false, returned: 0, total: 0 },
  contexts: { hasMore: false, returned: 0, total: 0 },
  experiences: { hasMore: false, returned: 0, total: 0 },
  identities: { hasMore: false, returned: 0, total: 0 },
  preferences: { hasMore: false, returned: 0, total: 0 },
});

const createEmptyTaxonomyResult = (): QueryTaxonomyOptionsResult => ({
  categories: [],
  hasMore: {},
  labels: [],
  relationships: [],
  roles: [],
  statuses: [],
  tags: [],
  types: [],
});

const coerceDate = (input: unknown): Date | null => {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

const escapeLikePattern = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');

const buildContainsCondition = (column: unknown, q?: string) => {
  const normalized = q?.trim();
  if (!normalized) return undefined;

  return sql<boolean>`${column} ILIKE ${`%${escapeLikePattern(normalized)}%`} ESCAPE '\\'`;
};

const mergeTaxonomyRows = (
  rows: Array<{ count: number; layer: LayersEnum; value: string | null }>,
): QueryTaxonomyOptionsResult['labels'] => {
  const merged = new Map<string, TaxonomyOptionAccumulator>();

  for (const row of rows) {
    if (!row.value) continue;

    const current = merged.get(row.value) ?? { count: 0, layers: new Set<LayersEnum>() };
    current.count += row.count;
    current.layers.add(row.layer);
    merged.set(row.value, current);
  }

  return [...merged.entries()]
    .map(([value, aggregate]) => ({
      count: aggregate.count,
      layers: [...aggregate.layers].sort(),
      value,
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
};

const buildLayerArrayAggregationConfigs = (): LayerArrayAggregationConfig[] => [
  {
    column: userMemoriesActivities.tags,
    cteName: 'unnested_activity_labels',
    layer: LayersEnum.Activity,
    table: userMemoriesActivities,
    timeRangeColumns: {
      capturedAt: userMemoriesActivities.capturedAt,
      createdAt: userMemoriesActivities.createdAt,
      endsAt: userMemoriesActivities.endsAt,
      startsAt: userMemoriesActivities.startsAt,
      updatedAt: userMemoriesActivities.updatedAt,
    },
    userIdColumn: userMemoriesActivities.userId,
  },
  {
    column: userMemoriesContexts.tags,
    cteName: 'unnested_context_labels',
    layer: LayersEnum.Context,
    table: userMemoriesContexts,
    timeRangeColumns: {
      capturedAt: userMemoriesContexts.capturedAt,
      createdAt: userMemoriesContexts.createdAt,
      updatedAt: userMemoriesContexts.updatedAt,
    },
    userIdColumn: userMemoriesContexts.userId,
  },
  {
    column: userMemoriesExperiences.tags,
    cteName: 'unnested_experience_labels',
    layer: LayersEnum.Experience,
    table: userMemoriesExperiences,
    timeRangeColumns: {
      capturedAt: userMemoriesExperiences.capturedAt,
      createdAt: userMemoriesExperiences.createdAt,
      updatedAt: userMemoriesExperiences.updatedAt,
    },
    userIdColumn: userMemoriesExperiences.userId,
  },
  {
    column: userMemoriesIdentities.tags,
    cteName: 'unnested_identity_labels',
    layer: LayersEnum.Identity,
    table: userMemoriesIdentities,
    timeRangeColumns: {
      capturedAt: userMemoriesIdentities.capturedAt,
      createdAt: userMemoriesIdentities.createdAt,
      episodicDate: userMemoriesIdentities.episodicDate,
      updatedAt: userMemoriesIdentities.updatedAt,
    },
    userIdColumn: userMemoriesIdentities.userId,
  },
  {
    column: userMemoriesPreferences.tags,
    cteName: 'unnested_preference_labels',
    layer: LayersEnum.Preference,
    table: userMemoriesPreferences,
    timeRangeColumns: {
      capturedAt: userMemoriesPreferences.capturedAt,
      createdAt: userMemoriesPreferences.createdAt,
      updatedAt: userMemoriesPreferences.updatedAt,
    },
    userIdColumn: userMemoriesPreferences.userId,
  },
];

export const scoreHybridCandidates = <T extends { id: string; tags?: string[] | null }>(params: {
  baseSignals: Map<string, LayerBaseMemorySignals>;
  items: T[];
  lexicalLists: T[][];
  queries: string[];
  queryParams: SearchMemoryParams;
  semanticLists: T[][];
}): RankedSearchCandidate<T>[] => {
  const { baseSignals, items, lexicalLists, queries, queryParams, semanticLists } = params;
  if (items.length === 0) return [];

  const extractSearchableTerms = (value: unknown): string[] => {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (value instanceof Date) return [value.toISOString()];
    if (Array.isArray(value)) {
      return [...new Set(value.flatMap((item) => extractSearchableTerms(item)).filter(Boolean))];
    }
    if (typeof value === 'object') {
      return [
        ...new Set(
          Object.values(value as Record<string, unknown>)
            .flatMap((item) => extractSearchableTerms(item))
            .filter(Boolean),
        ),
      ];
    }

    return [];
  };

  const computeFuzzyScore = (item: unknown) => {
    const normalizedQueries = normalizeSearchTerms(queries);
    if (normalizedQueries.length === 0) return 0;

    const itemTerms = normalizeSearchTerms(extractSearchableTerms(item));
    if (itemTerms.length === 0) return 0;

    return clampScore(
      normalizedQueries.reduce(
        (bestScore, query) =>
          Math.max(
            bestScore,
            itemTerms.reduce(
              (innerBestScore, term) =>
                Math.max(innerBestScore, computeTermSimilarity(query, term)),
              0,
            ),
          ),
        0,
      ),
    );
  };

  const collectCandidateTimes = (
    item: Record<string, unknown>,
    baseSignal: LayerBaseMemorySignals,
  ) => {
    const values = [
      item.capturedAt,
      item.startsAt,
      item.endsAt,
      item.episodicDate,
      item.createdAt,
      item.updatedAt,
    ];

    const times = values
      .map((value) => coerceDate(value))
      .filter((value): value is Date => Boolean(value))
      .map((value) => value.getTime());

    return [...new Set([...times, ...baseSignal.times])];
  };

  const computeTemporalScore = (candidateTimes: number[]) => {
    const { timeRange } = queryParams;
    if (!timeRange || candidateTimes.length === 0) return 0;

    const fieldWindow =
      timeRange.start && timeRange.end
        ? Math.abs(timeRange.end.getTime() - timeRange.start.getTime()) ||
          DEFAULT_TEMPORAL_WINDOW_MS
        : DEFAULT_TEMPORAL_WINDOW_MS;

    return candidateTimes.reduce((bestScore, time) => {
      if (
        timeRange.start &&
        timeRange.end &&
        time >= timeRange.start.getTime() &&
        time <= timeRange.end.getTime()
      ) {
        return 1;
      }

      const distance =
        timeRange.start && timeRange.end
          ? Math.min(
              Math.abs(time - timeRange.start.getTime()),
              Math.abs(time - timeRange.end.getTime()),
            )
          : Math.abs(time - (timeRange.start?.getTime() ?? timeRange.end?.getTime() ?? time));

      return Math.max(bestScore, scoreTimeDistance(distance, fieldWindow));
    }, 0);
  };

  const computeClusterSignals = (
    candidateId: string,
    candidateCategories: string[],
    candidateTags: string[],
    candidateTimes: number[],
    seeds: Array<{
      categories: string[];
      id: string;
      tags: string[];
      times: number[];
    }>,
  ) => {
    let bestCategoryAffinity = 0;
    let bestTagAffinity = 0;
    let bestClusterBoost = 0;

    for (const seed of seeds) {
      if (seed.id === candidateId) continue;

      const categoryAffinity = computeArraySimilarity(candidateCategories, seed.categories);
      const tagAffinity = computeArraySimilarity(candidateTags, seed.tags);
      const timeDistance =
        candidateTimes.length && seed.times.length
          ? Math.min(
              ...candidateTimes.flatMap((candidateTime) =>
                seed.times.map((seedTime) => Math.abs(candidateTime - seedTime)),
              ),
            )
          : Number.POSITIVE_INFINITY;
      const shortTermAssociation = scoreTimeDistance(
        timeDistance,
        SHORT_TERM_ASSOCIATION_WINDOW_MS,
      );
      const clusterBoost = (0.55 * tagAffinity + 0.45 * categoryAffinity) * shortTermAssociation;

      bestCategoryAffinity = Math.max(bestCategoryAffinity, categoryAffinity);
      bestTagAffinity = Math.max(bestTagAffinity, tagAffinity);
      bestClusterBoost = Math.max(bestClusterBoost, clusterBoost);
    }

    return {
      categoryAffinity: clampScore(bestCategoryAffinity),
      clusterBoost: clampScore(bestClusterBoost),
      tagAffinity: clampScore(bestTagAffinity),
    };
  };

  const candidates = new Map<
    string,
    {
      categories: string[];
      fuzzyScore: number;
      item: T;
      keywordScore: number;
      semanticScore: number;
      tags: string[];
      temporalScore: number;
      times: number[];
    }
  >();

  const registerRankedList = (list: T[], source: 'keyword' | 'semantic') => {
    list.forEach((item, index) => {
      const baseSignal = baseSignals.get(item.id) ?? {
        categories: [],
        memoryIds: [],
        tags: [],
        times: [],
      };
      const tags = [...new Set([...(item.tags ?? []), ...baseSignal.tags])];
      const times = collectCandidateTimes(item as Record<string, unknown>, baseSignal);
      const existing = candidates.get(item.id) ?? {
        categories: baseSignal.categories,
        fuzzyScore: computeFuzzyScore(item),
        item,
        keywordScore: 0,
        semanticScore: 0,
        tags,
        temporalScore: computeTemporalScore(times),
        times,
      };

      if (source === 'keyword') {
        existing.keywordScore = Math.max(existing.keywordScore, reciprocalRankScore(index));
      } else {
        existing.semanticScore = Math.max(existing.semanticScore, reciprocalRankScore(index));
      }

      existing.categories = [...new Set([...existing.categories, ...baseSignal.categories])];
      existing.tags = [...new Set([...existing.tags, ...tags])];
      existing.times = [...new Set([...existing.times, ...times])];
      existing.temporalScore = Math.max(
        existing.temporalScore,
        computeTemporalScore(existing.times),
      );
      candidates.set(item.id, existing);
    });
  };

  lexicalLists.forEach((list) => registerRankedList(list, 'keyword'));
  semanticLists.forEach((list) => registerRankedList(list, 'semantic'));

  const preliminary = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      preliminaryScore:
        0.34 * candidate.keywordScore +
        0.28 * candidate.semanticScore +
        0.2 * candidate.fuzzyScore +
        0.18 * candidate.temporalScore,
    }))
    .sort((left, right) => right.preliminaryScore - left.preliminaryScore);

  const seeds = preliminary.slice(0, Math.min(3, preliminary.length)).map((candidate) => ({
    categories: candidate.categories,
    id: candidate.item.id,
    tags: candidate.tags,
    times: candidate.times,
  }));

  return preliminary
    .map((candidate) => {
      const clusterSignals = computeClusterSignals(
        candidate.item.id,
        candidate.categories,
        candidate.tags,
        candidate.times,
        seeds,
      );
      const breakdown: RecommendationScoreBreakdown = {
        categoryAffinity: clusterSignals.categoryAffinity,
        clusterBoost: clusterSignals.clusterBoost,
        final: 0,
        fuzzy: clampScore(candidate.fuzzyScore),
        keyword: clampScore(candidate.keywordScore),
        semantic: clampScore(candidate.semanticScore),
        tagAffinity: clusterSignals.tagAffinity,
        temporal: clampScore(candidate.temporalScore),
      };

      const crossSignalBoost = breakdown.keyword > 0 && breakdown.semantic > 0 ? 0.06 : 0;
      breakdown.final = clampScore(
        0.24 * breakdown.keyword +
          0.22 * breakdown.semantic +
          0.18 * breakdown.fuzzy +
          0.14 * breakdown.temporal +
          0.12 * breakdown.tagAffinity +
          0.06 * breakdown.categoryAffinity +
          0.08 * breakdown.clusterBoost +
          crossSignalBoost,
      );

      return {
        item: candidate.item,
        score: breakdown,
      };
    })
    .sort((left, right) => right.score.final - left.score.final);
};

export class UserMemoryQueryModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  /**
   * Hybrid memory retrieval pipeline for the five heterogeneous memory layers.
   *
   * High-level design:
   * - This engine does NOT try to force every memory layer into a single universal SQL ranking query.
   * - Each layer keeps its own retrieval logic because the underlying schemas, searchable fields,
   *   time semantics, and filters are materially different across activities, contexts, experiences,
   *   identities, and preferences.
   * - Instead, the engine follows a "bounded multi-channel retrieval + JS reranking" design:
   *   1. Normalize user input (`queries`, filters, `topK`, layer selection).
   *   2. For each active layer, retrieve candidates through at most:
   *      - one lexical query
   *      - one semantic query
   *   3. Merge and deduplicate candidates inside the application.
   *   4. Load base-memory signals for the merged candidates.
   *   5. Compute a recommendation-style final score in JS and select top-K per layer.
   *
   * Why reranking stays in JS:
   * - Lexical match, embedding similarity, temporal relevance, tag/category affinity, and
   *   short-term cluster association are easier to evolve and tune in business logic than in a
   *   single monolithic SQL statement.
   * - Cross-layer schemas are not fully homogeneous, so keeping the final score composition in JS
   *   avoids overfitting the database query shape to a scoring model that will likely keep changing.
   *
   * Scoring / solving flow for one layer:
   * 1. Lexical retrieval:
   *    - Uses a single combined retrieval query string for the layer.
   *    - Applies exact filters first (categories, tags/labels, types, status, relationships,
   *      timeRange, etc.).
   * 2. Semantic retrieval:
   *    - Uses a single combined embedding vector for the layer.
   *    - Applies the same exact filters before vector ordering.
   * 3. Candidate merge:
   *    - Union lexical and semantic candidate sets by item id.
   * 4. Base-signal enrichment:
   *    - Load linked base-memory category / tag / time metadata for the merged candidate ids.
   * 5. JS reranking (`scoreHybridCandidates`):
   *    - `keyword`: reciprocal-rank style lexical signal
   *    - `semantic`: reciprocal-rank style vector signal
   *    - `fuzzy`: lightweight term similarity over candidate content
   *    - `temporal`: closeness to the requested timeRange when present
   *    - `tagAffinity`: similarity to nearby high-confidence seed memories
   *    - `categoryAffinity`: same as above, for categories
   *    - `clusterBoost`: short-term association boost for memories with similar tags/categories
   *      that occur in a tight temporal window
   * 6. Final selection:
   *    - Sort by the final blended score
   *    - Return the top-K items for that layer
   *    - Record `meta.layers` and `meta.ranking`
   *
   * Important implementation notes:
   * - `topK: 0` disables retrieval for that layer entirely.
   * - Query count is intentionally bounded. The engine no longer fans out per query string or per
   *   embedding vector within a layer.
   * - Context retrieval is special:
   *   - Contexts may link to multiple base memories through `userMemoryIds`.
   *   - SQL deduplication happens before `LIMIT`, so duplicate join rows do not consume candidate
   *     slots and distort recall quality.
   * - This is a hybrid reranker, not a fully unified "single SQL ranks all layers" engine.
   *   That tradeoff is deliberate for maintainability and score calibration.
   *
   * Approximate SQL call mapping for this method:
   *
   * Per active layer, the upper bound is usually:
   * - 1 lexical candidate query
   * - 1 semantic candidate query
   * - 1 base-signal query (`loadBaseSignals`) after candidate merge
   * => up to 3 SQL calls per active layer
   *
   * Typical per-layer behavior:
   *
   * | Layer state | SQL calls |
   * | --- | ---: |
   * | `topK = 0` | 0 |
   * | lexical only | 1 to 2 |
   * | semantic only | 1 to 2 |
   * | lexical + semantic, no merged candidates | 2 |
   * | lexical + semantic, merged candidates present | 3 |
   *
   * Whole-request upper bound inside this query model:
   *
   * | Active layers | Approx. max SQL calls |
   * | --- | ---: |
   * | 1 | 3 |
   * | 2 | 6 |
   * | 3 | 9 |
   * | 4 | 12 |
   * | 5 | 15 |
   *
   * Notes on the table above:
   * - These counts describe SQL issued by `UserMemoryQueryModel.searchMemory(...)` itself.
   * - They do NOT include embedding/model calls.
   * - They do NOT include router/middleware-level queries outside this model.
   * - Real requests are often below the upper bound because inactive layers, missing embeddings,
   *   missing lexical terms, or empty candidate sets can skip later stages.
   */
  searchMemory = async (
    params: SearchMemoryParams,
    queryEmbeddings: number[][] = [],
  ): Promise<UserMemoryHybridSearchAggregatedResult> => {
    const appliedQueries = normalizeSearchQueries(params.queries);
    const limits: HybridLayerLimitRecord = {
      activities: params.topK?.activities ?? DEFAULT_HYBRID_SEARCH_LIMIT,
      contexts: params.topK?.contexts ?? DEFAULT_HYBRID_SEARCH_LIMIT,
      experiences: params.topK?.experiences ?? DEFAULT_HYBRID_SEARCH_LIMIT,
      identities: params.topK?.identities ?? DEFAULT_HYBRID_SEARCH_LIMIT,
      preferences: params.topK?.preferences ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    };
    const requestedLayers = new Set(
      (params.layers ?? Object.values(LayersEnum)).filter((layer) => {
        switch (layer) {
          case LayersEnum.Activity: {
            return (limits.activities ?? 0) > 0;
          }
          case LayersEnum.Context: {
            return (limits.contexts ?? 0) > 0;
          }
          case LayersEnum.Experience: {
            return (limits.experiences ?? 0) > 0;
          }
          case LayersEnum.Identity: {
            return (limits.identities ?? 0) > 0;
          }
          case LayersEnum.Preference: {
            return (limits.preferences ?? 0) > 0;
          }
        }
      }),
    );

    const layerMeta = createEmptySearchLayerMeta();

    const [activities, contexts, experiences, identities, preferences] = await Promise.all([
      requestedLayers.has(LayersEnum.Activity)
        ? this.searchHybridActivities({
            embeddings: queryEmbeddings,
            params,
            queries: appliedQueries,
          })
        : Promise.resolve([]),
      requestedLayers.has(LayersEnum.Context)
        ? this.searchHybridContexts({
            embeddings: queryEmbeddings,
            params,
            queries: appliedQueries,
          })
        : Promise.resolve([]),
      requestedLayers.has(LayersEnum.Experience)
        ? this.searchHybridExperiences({
            embeddings: queryEmbeddings,
            params,
            queries: appliedQueries,
          })
        : Promise.resolve([]),
      requestedLayers.has(LayersEnum.Identity)
        ? this.searchHybridIdentities({
            embeddings: queryEmbeddings,
            params,
            queries: appliedQueries,
          })
        : Promise.resolve([]),
      requestedLayers.has(LayersEnum.Preference)
        ? this.searchHybridPreferences({
            embeddings: queryEmbeddings,
            params,
            queries: appliedQueries,
          })
        : Promise.resolve([]),
    ]);

    const ranking: Partial<Record<SearchLayerKey, Record<string, RecommendationScoreBreakdown>>> =
      {};

    const finalizeLayer = <T extends { id: string }>(
      key: SearchLayerKey,
      items: RankedSearchCandidate<T>[],
    ) => {
      const limit = limits[key] ?? DEFAULT_HYBRID_SEARCH_LIMIT;
      const sorted = items.sort((left, right) => right.score.final - left.score.final);
      const selected = sorted.slice(0, limit).map((entry) => entry.item);
      ranking[key] = Object.fromEntries(
        sorted.slice(0, limit).map((entry) => [entry.item.id, entry.score]),
      );

      layerMeta[key] = {
        hasMore: sorted.length > limit,
        returned: selected.length,
        total: sorted.length,
      };

      return selected;
    };

    return {
      activities: finalizeLayer('activities', activities),
      contexts: finalizeLayer('contexts', contexts),
      experiences: finalizeLayer('experiences', experiences),
      identities: finalizeLayer('identities', identities),
      meta: {
        appliedFilters: {
          categories: params.categories,
          labels: params.labels,
          layers: params.layers,
          queries: appliedQueries,
          relationships: params.relationships,
          status: params.status,
          tags: params.tags,
          timeRange: params.timeRange,
          types: params.types,
        },
        appliedQueries,
        layers: layerMeta,
        ranking,
      },
      preferences: finalizeLayer('preferences', preferences),
    };
  };

  /**
   * Taxonomy lookup pipeline for memory-aware search and extraction.
   *
   * Purpose:
   * - Provide the current vocabulary already present in user memory so downstream retrieval,
   *   extraction, and prompting logic can align with existing categories, tags, labels,
   *   statuses, roles, relationships, and types.
   * - This is intentionally a lookup / aggregation API, not a ranking API.
   *
   * High-level design:
   * - The method exposes several independently-computable taxonomy buckets.
   * - Callers can request a subset through `include`, or omit it to fetch the default set.
   * - Each bucket is aggregated from the underlying memory tables that actually own that field.
   * - Results are filtered by optional `layers`, `q`, and `timeRange`.
   *
   * Bucket semantics:
   * - `categories`:
   *   - Aggregated from base memories (`user_memories.memory_category`).
   *   - Supports optional layer filtering because base memories carry `memoryLayer`.
   * - `tags`:
   *   - Aggregated from base-memory tags (`user_memories.tags`).
   *   - Useful for stable user-defined tags already attached to the memory root.
   * - `labels`:
   *   - Aggregated from layer-local tag arrays across activity/context/experience/identity/preference.
   *   - Merges repeated values across layers and records which layers they appear in.
   * - `types`:
   *   - Aggregated from each layer's `type` column.
   * - `statuses`:
   *   - Aggregated from activity `status` and context `currentStatus`.
   * - `relationships` / `roles`:
   *   - Aggregated from the identity layer only.
   *
   * Query flow:
   * 1. Resolve the requested bucket set (`include`) and per-bucket `limit`.
   * 2. For each requested bucket:
   *    - Build the exact SQL aggregation for the owning table(s)
   *    - Apply `userId` scoping
   *    - Apply optional `layers`, `q`, and `timeRange`
   *    - Group and count values
   *    - Sort by count descending, then value ascending
   * 3. For multi-layer buckets (`labels`, `types`, `statuses`):
   *    - Merge rows from multiple tables in JS
   *    - Preserve layer provenance where applicable
   * 4. Return the requested buckets plus lightweight `hasMore` hints.
   *
   * Important implementation notes:
   * - `hasMore` is a lightweight hint based on `result.length >= limit`; it is not a strict proof
   *   of another page because this API does not overfetch by one.
   * - `labels` and `tags` are intentionally different:
   *   - `tags` come from the base memory root
   *   - `labels` come from layer-local tag arrays
   * - `timeRange` uses the field map available for each bucket's source tables; if a requested
   *   field is not supported by a source table, that source resolves to `false` and contributes no rows.
   * - Because different buckets come from different tables, this method favors correctness and
   *   maintainability over forcing everything into one giant aggregation query.
   *
   * Approximate SQL call mapping:
   *
   * | Requested bucket | Approx. SQL calls |
   * | --- | ---: |
   * | `categories` | 1 |
   * | `tags` | 1 |
   * | `labels` | 1 per eligible layer table, then merged in JS |
   * | `types` | 1 per eligible layer table, then merged in JS |
   * | `statuses` | up to 2 (activity + context), then merged in JS |
   * | `relationships` | 1 |
   * | `roles` | 1 |
   *
   * Whole-request examples:
   *
   * | Params shape | Approx. SQL calls |
   * | --- | ---: |
   * | `include: ['categories']` | 1 |
   * | `include: ['tags', 'labels']` with all layers | 1 + up to 5 |
   * | `include: ['relationships', 'roles']` | 2 |
   * | default include set with all layers | roughly 16 in the current implementation |
   *
   * Notes on the estimates above:
   * - Counts are approximate and describe SQL issued by this method itself.
   * - Real call count depends on `include` and `layers`.
   * - Restricting `layers` can significantly reduce the multi-table aggregation cost.
   */
  queryTaxonomyOptions = async (
    params: QueryTaxonomyOptionsParams = {},
  ): Promise<QueryTaxonomyOptionsResult> => {
    const include = new Set(
      params.include ?? [
        'categories',
        'labels',
        'relationships',
        'roles',
        'statuses',
        'tags',
        'types',
      ],
    );
    const limit = params.limit ?? DEFAULT_TAXONOMY_LIMIT;
    const result = createEmptyTaxonomyResult();

    if (include.has('categories')) {
      result.categories = await this.aggregateBaseMemoryOptions({
        column: userMemories.memoryCategory,
        layers: params.layers,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.categories = result.categories.length >= limit;
    }

    if (include.has('tags')) {
      result.tags = await this.aggregateBaseArrayOptions({
        column: userMemories.tags,
        layers: params.layers,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.tags = result.tags.length >= limit;
    }

    if (include.has('labels')) {
      result.labels = await this.aggregateLayerLabels({
        layers: params.layers,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.labels = result.labels.length >= limit;
    }

    if (include.has('types')) {
      result.types = await this.aggregateLayerTypes({
        layers: params.layers,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.types = result.types.length >= limit;
    }

    if (include.has('statuses')) {
      result.statuses = await this.aggregateStatuses({
        layers: params.layers,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.statuses = result.statuses.length >= limit;
    }

    if (include.has('relationships')) {
      result.relationships = await this.aggregateIdentityValueOptions({
        column: userMemoriesIdentities.relationship,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.relationships = result.relationships.length >= limit;
    }

    if (include.has('roles')) {
      result.roles = await this.aggregateIdentityValueOptions({
        column: userMemoriesIdentities.role,
        limit,
        q: params.q,
        timeRange: params.timeRange,
      });
      result.hasMore.roles = result.roles.length >= limit;
    }

    return result;
  };

  private getSearchLimit(key: SearchLayerKey, params: SearchMemoryParams) {
    return params.topK?.[key] ?? DEFAULT_HYBRID_SEARCH_LIMIT;
  }

  private getSearchOverfetchLimit(key: SearchLayerKey, params: SearchMemoryParams) {
    const layerLimit = this.getSearchLimit(key, params);
    if (layerLimit <= 0) return 0;

    return layerLimit * HYBRID_SEARCH_OVERFETCH_MULTIPLIER;
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
    if (!timeRange) return undefined;

    const { end, field = 'capturedAt', start } = timeRange;
    const column = fieldMap[field];
    if (!column) return sql`false`;

    if (start && end) return and(gte(column, start), lte(column, end));
    if (start) return gte(column, start);
    if (end) return lte(column, end);

    return undefined;
  }

  private collectCandidateMemoryIds(item: {
    userMemoryId?: string | null;
    userMemoryIds?: string[] | null;
  }) {
    if (Array.isArray(item.userMemoryIds)) {
      return item.userMemoryIds.filter(Boolean);
    }

    return item.userMemoryId ? [item.userMemoryId] : [];
  }

  private async loadBaseSignals<
    T extends { id: string; userMemoryId?: string | null; userMemoryIds?: string[] | null },
  >(items: T[]) {
    const memoryIds = [...new Set(items.flatMap((item) => this.collectCandidateMemoryIds(item)))];
    if (memoryIds.length === 0) {
      return new Map<string, LayerBaseMemorySignals>();
    }

    const baseMemories = await this.db
      .select({
        capturedAt: userMemories.capturedAt,
        createdAt: userMemories.createdAt,
        id: userMemories.id,
        memoryCategory: userMemories.memoryCategory,
        tags: userMemories.tags,
        updatedAt: userMemories.updatedAt,
      })
      .from(userMemories)
      .where(and(eq(userMemories.userId, this.userId), inArray(userMemories.id, memoryIds)));

    const baseMemoryMap = new Map(
      baseMemories.map((memory) => [
        memory.id,
        {
          category: memory.memoryCategory ? [memory.memoryCategory] : [],
          tags: memory.tags ?? [],
          times: [memory.capturedAt, memory.createdAt, memory.updatedAt]
            .map((value) => coerceDate(value))
            .filter((value): value is Date => Boolean(value))
            .map((value) => value.getTime()),
        },
      ]),
    );

    return new Map(
      items.map((item) => {
        const itemMemoryIds = this.collectCandidateMemoryIds(item);
        const signals = itemMemoryIds.reduce<LayerBaseMemorySignals>(
          (accumulator, memoryId) => {
            const baseMemory = baseMemoryMap.get(memoryId);
            if (!baseMemory) return accumulator;

            accumulator.categories.push(...baseMemory.category);
            accumulator.memoryIds.push(memoryId);
            accumulator.tags.push(...baseMemory.tags);
            accumulator.times.push(...baseMemory.times);

            return accumulator;
          },
          { categories: [], memoryIds: [], tags: [], times: [] },
        );

        return [
          item.id,
          {
            categories: [...new Set(signals.categories)],
            memoryIds: [...new Set(signals.memoryIds)],
            tags: [...new Set(signals.tags)],
            times: [...new Set(signals.times)],
          },
        ];
      }),
    );
  }

  private hasSearchFilters(params: SearchMemoryParams) {
    return Boolean(
      params.categories?.length ||
      params.labels?.length ||
      params.relationships?.length ||
      params.status?.length ||
      params.tags?.length ||
      params.timeRange ||
      params.types?.length,
    );
  }

  private shouldRunSemanticSearch(queryCount: number, embeddingsCount: number) {
    return queryCount > 0 && embeddingsCount > 0;
  }

  private toSearchTags(params: SearchMemoryParams) {
    return [...new Set([...(params.tags ?? []), ...(params.labels ?? [])])];
  }

  private buildExactTagFilterCondition(
    layerTags: AnyColumn,
    baseTags: AnyColumn,
    params: SearchMemoryParams,
  ) {
    const tags = this.toSearchTags(params);
    if (tags.length === 0) return undefined;

    return and(
      ...tags.map(
        (tag) =>
          sql<boolean>`
            (
              COALESCE(${tag} = ANY(${layerTags}), false)
              OR COALESCE(${tag} = ANY(${baseTags}), false)
            )
          `,
      ),
    );
  }

  private async aggregateBaseMemoryOptions(params: {
    column: typeof userMemories.memoryCategory | typeof userMemories.memoryType;
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['categories']> {
    const { column, layers, limit, q, timeRange } = params;
    const conditions = [
      eq(userMemories.userId, this.userId),
      layers?.length ? inArray(userMemories.memoryLayer, layers) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemories.capturedAt,
          createdAt: userMemories.createdAt,
          updatedAt: userMemories.updatedAt,
        },
        timeRange,
      ),
      buildContainsCondition(column, q),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        count: sql<number>`COUNT(*)::int`.as('count'),
        value: column,
      })
      .from(userMemories)
      .where(and(...conditions))
      .groupBy(column)
      .orderBy(desc(sql<number>`COUNT(*)::int`), asc(column))
      .limit(limit);

    const rows = await rowsQuery;

    return rows
      .filter((row) => row.value)
      .map((row) => ({ count: row.count, layers: undefined, value: row.value! }));
  }

  private async aggregateBaseArrayOptions(params: {
    column: typeof userMemories.tags;
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['tags']> {
    const { column, layers, limit, q, timeRange } = params;
    const conditions = [
      eq(userMemories.userId, this.userId),
      layers?.length ? inArray(userMemories.memoryLayer, layers) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemories.capturedAt,
          createdAt: userMemories.createdAt,
          updatedAt: userMemories.updatedAt,
        },
        timeRange,
      ),
    ].filter((condition): condition is SQL => Boolean(condition));

    const unnestedTags = this.db.$with('unnested_memory_tags').as(
      this.db
        .select({ value: sql<string>`UNNEST(${column})`.as('value') })
        .from(userMemories)
        .where(and(...conditions)),
    );

    const rowsQuery = this.db
      .with(unnestedTags)
      .select({
        count: sql<number>`COUNT(${unnestedTags.value})::int`.as('count'),
        value: unnestedTags.value,
      })
      .from(unnestedTags)
      .where(
        and(
          isNotNull(unnestedTags.value),
          ne(unnestedTags.value, ''),
          buildContainsCondition(unnestedTags.value, q),
        ),
      )
      .groupBy(unnestedTags.value)
      .orderBy(desc(sql<number>`COUNT(${unnestedTags.value})::int`), asc(unnestedTags.value))
      .limit(limit);

    const rows = await rowsQuery;

    return rows.map((row) => ({ count: row.count, layers: undefined, value: row.value }));
  }

  private async aggregateLayerArrayValues(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }) {
    const configs = buildLayerArrayAggregationConfigs().filter(
      (config) => !params.layers?.length || params.layers.includes(config.layer),
    );

    const rows = await Promise.all(
      configs.map(async (config) => {
        const unnested = this.db.$with(config.cteName).as(
          this.db
            .select({ value: sql<string>`UNNEST(${config.column})`.as('value') })
            .from(config.table)
            .where(
              and(
                eq(config.userIdColumn, this.userId),
                this.buildTimeRangeCondition(config.timeRangeColumns, params.timeRange),
              ),
            ),
        );

        return (await this.db
          .with(unnested)
          .select({
            count: sql<number>`COUNT(${unnested.value})::int`.as('count'),
            layer: sql<LayersEnum>`${config.layer}`.as('layer'),
            value: unnested.value,
          })
          .from(unnested)
          .where(
            and(
              isNotNull(unnested.value),
              ne(unnested.value, ''),
              buildContainsCondition(unnested.value, params.q),
            ),
          )
          .groupBy(unnested.value)
          .orderBy(desc(sql<number>`COUNT(${unnested.value})::int`), asc(unnested.value))
          .limit(params.limit)) as Array<{
          count: number;
          layer: LayersEnum;
          value: string | null;
        }>;
      }),
    );

    return mergeTaxonomyRows(rows.flat()).slice(0, params.limit);
  }

  private async aggregateLayerLabels(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['labels']> {
    return this.aggregateLayerArrayValues(params);
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
    const { column, layer, limit, q, table, timeRange, timeRangeColumns, userIdColumn } = params;

    const rowsQuery = this.db
      .select({
        count: sql<number>`COUNT(*)::int`.as('count'),
        layer: sql<LayersEnum>`${layer}`.as('layer'),
        value: column as AnyColumn & SQL,
      })
      .from(table)
      .where(
        and(
          eq(userIdColumn, this.userId),
          this.buildTimeRangeCondition(timeRangeColumns, timeRange),
          buildContainsCondition(column, q),
        ),
      )
      .groupBy(column as AnyColumn & SQL)
      .orderBy(desc(sql<number>`COUNT(*)::int`), asc(column as AnyColumn & SQL))
      .limit(limit);

    return (await rowsQuery) as Array<{ count: number; layer: LayersEnum; value: string | null }>;
  }

  private async aggregateScalarLayerValues(params: {
    configs: LayerScalarAggregationConfig[];
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }) {
    const rows = await Promise.all(
      params.configs
        .filter((config) => !params.layers?.length || params.layers.includes(config.layer))
        .map((config) =>
          this.aggregateTypedLayerValues({
            column: config.column,
            layer: config.layer,
            limit: params.limit,
            q: params.q,
            table: config.table,
            timeRange: params.timeRange,
            timeRangeColumns: config.timeRangeColumns,
            userIdColumn: config.userIdColumn,
          }),
        ),
    );

    return mergeTaxonomyRows(rows.flat()).slice(0, params.limit);
  }

  private async aggregateLayerTypes(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['types']> {
    return this.aggregateScalarLayerValues({
      configs: [
        {
          column: userMemoriesActivities.type,
          layer: LayersEnum.Activity,
          table: userMemoriesActivities,
          timeRangeColumns: {
            capturedAt: userMemoriesActivities.capturedAt,
            createdAt: userMemoriesActivities.createdAt,
            endsAt: userMemoriesActivities.endsAt,
            startsAt: userMemoriesActivities.startsAt,
            updatedAt: userMemoriesActivities.updatedAt,
          },
          userIdColumn: userMemoriesActivities.userId,
        },
        {
          column: userMemoriesContexts.type,
          layer: LayersEnum.Context,
          table: userMemoriesContexts,
          timeRangeColumns: {
            capturedAt: userMemoriesContexts.capturedAt,
            createdAt: userMemoriesContexts.createdAt,
            updatedAt: userMemoriesContexts.updatedAt,
          },
          userIdColumn: userMemoriesContexts.userId,
        },
        {
          column: userMemoriesExperiences.type,
          layer: LayersEnum.Experience,
          table: userMemoriesExperiences,
          timeRangeColumns: {
            capturedAt: userMemoriesExperiences.capturedAt,
            createdAt: userMemoriesExperiences.createdAt,
            updatedAt: userMemoriesExperiences.updatedAt,
          },
          userIdColumn: userMemoriesExperiences.userId,
        },
        {
          column: userMemoriesIdentities.type,
          layer: LayersEnum.Identity,
          table: userMemoriesIdentities,
          timeRangeColumns: {
            capturedAt: userMemoriesIdentities.capturedAt,
            createdAt: userMemoriesIdentities.createdAt,
            episodicDate: userMemoriesIdentities.episodicDate,
            updatedAt: userMemoriesIdentities.updatedAt,
          },
          userIdColumn: userMemoriesIdentities.userId,
        },
        {
          column: userMemoriesPreferences.type,
          layer: LayersEnum.Preference,
          table: userMemoriesPreferences,
          timeRangeColumns: {
            capturedAt: userMemoriesPreferences.capturedAt,
            createdAt: userMemoriesPreferences.createdAt,
            updatedAt: userMemoriesPreferences.updatedAt,
          },
          userIdColumn: userMemoriesPreferences.userId,
        },
      ],
      layers: params.layers,
      limit: params.limit,
      q: params.q,
      timeRange: params.timeRange,
    });
  }

  private async aggregateStatuses(params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['statuses']> {
    return this.aggregateScalarLayerValues({
      configs: [
        {
          column: userMemoriesActivities.status,
          layer: LayersEnum.Activity,
          table: userMemoriesActivities,
          timeRangeColumns: {
            capturedAt: userMemoriesActivities.capturedAt,
            createdAt: userMemoriesActivities.createdAt,
            endsAt: userMemoriesActivities.endsAt,
            startsAt: userMemoriesActivities.startsAt,
            updatedAt: userMemoriesActivities.updatedAt,
          },
          userIdColumn: userMemoriesActivities.userId,
        },
        {
          column: userMemoriesContexts.currentStatus,
          layer: LayersEnum.Context,
          table: userMemoriesContexts,
          timeRangeColumns: {
            capturedAt: userMemoriesContexts.capturedAt,
            createdAt: userMemoriesContexts.createdAt,
            updatedAt: userMemoriesContexts.updatedAt,
          },
          userIdColumn: userMemoriesContexts.userId,
        },
      ],
      layers: params.layers,
      limit: params.limit,
      q: params.q,
      timeRange: params.timeRange,
    });
  }

  private async aggregateIdentityValueOptions(params: {
    column: typeof userMemoriesIdentities.relationship | typeof userMemoriesIdentities.role;
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  }): Promise<QueryTaxonomyOptionsResult['relationships']> {
    const { column, limit, q, timeRange } = params;
    const rows = await this.db
      .select({
        count: sql<number>`COUNT(*)::int`.as('count'),
        value: column,
      })
      .from(userMemoriesIdentities)
      .where(
        and(
          eq(userMemoriesIdentities.userId, this.userId),
          this.buildTimeRangeCondition(
            {
              capturedAt: userMemoriesIdentities.capturedAt,
              createdAt: userMemoriesIdentities.createdAt,
              episodicDate: userMemoriesIdentities.episodicDate,
              updatedAt: userMemoriesIdentities.updatedAt,
            },
            timeRange,
          ),
          buildContainsCondition(column, q),
        ),
      )
      .groupBy(column)
      .orderBy(desc(sql<number>`COUNT(*)::int`), asc(column))
      .limit(limit);

    return rows
      .filter((row) => row.value)
      .map((row) => ({ count: row.count, layers: [LayersEnum.Identity], value: row.value! }));
  }

  private async searchHybridActivities(params: {
    embeddings: number[][];
    params: SearchMemoryParams;
    queries: string[];
  }) {
    const limit = this.getSearchOverfetchLimit('activities', params.params);
    if (limit <= 0) return [];

    const semanticEmbedding = combineEmbeddings(params.embeddings);
    const semanticLists =
      semanticEmbedding &&
      this.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
        ? [await this.searchActivitiesSemantic(semanticEmbedding, limit, params.params)]
        : [];
    const retrievalQuery = buildRetrievalQuery(params.queries);
    const lexicalLists =
      retrievalQuery || this.hasSearchFilters(params.params)
        ? [await this.searchActivitiesLexical(retrievalQuery, limit, params.params)]
        : [];

    const items = [
      ...new Map(
        [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
      ).values(),
    ];

    return scoreHybridCandidates({
      baseSignals: await this.loadBaseSignals(items),
      items,
      lexicalLists,
      queries: params.queries,
      queryParams: params.params,
      semanticLists,
    });
  }

  private async searchHybridContexts(params: {
    embeddings: number[][];
    params: SearchMemoryParams;
    queries: string[];
  }) {
    const limit = this.getSearchOverfetchLimit('contexts', params.params);
    if (limit <= 0) return [];

    const semanticEmbedding = combineEmbeddings(params.embeddings);
    const semanticLists =
      semanticEmbedding &&
      this.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
        ? [await this.searchContextsSemantic(semanticEmbedding, limit, params.params)]
        : [];
    const retrievalQuery = buildRetrievalQuery(params.queries);
    const lexicalLists =
      retrievalQuery || this.hasSearchFilters(params.params)
        ? [await this.searchContextsLexical(retrievalQuery, limit, params.params)]
        : [];

    const items = [
      ...new Map(
        [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
      ).values(),
    ];

    return scoreHybridCandidates({
      baseSignals: await this.loadBaseSignals(items),
      items,
      lexicalLists,
      queries: params.queries,
      queryParams: params.params,
      semanticLists,
    });
  }

  private async searchHybridExperiences(params: {
    embeddings: number[][];
    params: SearchMemoryParams;
    queries: string[];
  }) {
    const limit = this.getSearchOverfetchLimit('experiences', params.params);
    if (limit <= 0) return [];

    const semanticEmbedding = combineEmbeddings(params.embeddings);
    const semanticLists =
      semanticEmbedding &&
      this.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
        ? [await this.searchExperiencesSemantic(semanticEmbedding, limit, params.params)]
        : [];
    const retrievalQuery = buildRetrievalQuery(params.queries);
    const lexicalLists =
      retrievalQuery || this.hasSearchFilters(params.params)
        ? [await this.searchExperiencesLexical(retrievalQuery, limit, params.params)]
        : [];

    const items = [
      ...new Map(
        [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
      ).values(),
    ];

    return scoreHybridCandidates({
      baseSignals: await this.loadBaseSignals(items),
      items,
      lexicalLists,
      queries: params.queries,
      queryParams: params.params,
      semanticLists,
    });
  }

  private async searchHybridIdentities(params: {
    embeddings: number[][];
    params: SearchMemoryParams;
    queries: string[];
  }) {
    const limit = this.getSearchOverfetchLimit('identities', params.params);
    if (limit <= 0) return [];

    const semanticEmbedding = combineEmbeddings(params.embeddings);
    const semanticLists =
      semanticEmbedding &&
      this.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
        ? [await this.searchIdentitiesSemantic(semanticEmbedding, limit, params.params)]
        : [];
    const retrievalQuery = buildRetrievalQuery(params.queries);
    const lexicalLists =
      retrievalQuery || this.hasSearchFilters(params.params)
        ? [await this.searchIdentitiesLexical(retrievalQuery, limit, params.params)]
        : [];

    const items = [
      ...new Map(
        [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
      ).values(),
    ];

    return scoreHybridCandidates({
      baseSignals: await this.loadBaseSignals(items),
      items,
      lexicalLists,
      queries: params.queries,
      queryParams: params.params,
      semanticLists,
    });
  }

  private async searchHybridPreferences(params: {
    embeddings: number[][];
    params: SearchMemoryParams;
    queries: string[];
  }) {
    const limit = this.getSearchOverfetchLimit('preferences', params.params);
    if (limit <= 0) return [];

    const semanticEmbedding = combineEmbeddings(params.embeddings);
    const semanticLists =
      semanticEmbedding &&
      this.shouldRunSemanticSearch(params.queries.length, params.embeddings.length)
        ? [await this.searchPreferencesSemantic(semanticEmbedding, limit, params.params)]
        : [];
    const retrievalQuery = buildRetrievalQuery(params.queries);
    const lexicalLists =
      retrievalQuery || this.hasSearchFilters(params.params)
        ? [await this.searchPreferencesLexical(retrievalQuery, limit, params.params)]
        : [];

    const items = [
      ...new Map(
        [...semanticLists.flat(), ...lexicalLists.flat()].map((item) => [item.id, item]),
      ).values(),
    ];

    return scoreHybridCandidates({
      baseSignals: await this.loadBaseSignals(items),
      items,
      lexicalLists,
      queries: params.queries,
      queryParams: params.params,
      semanticLists,
    });
  }

  private async searchActivitiesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    const conditions = [
      eq(userMemoriesActivities.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.status?.length ? inArray(userMemoriesActivities.status, params.status) : undefined,
      params.types?.length ? inArray(userMemoriesActivities.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesActivities.capturedAt,
          createdAt: userMemoriesActivities.createdAt,
          endsAt: userMemoriesActivities.endsAt,
          startsAt: userMemoriesActivities.startsAt,
          updatedAt: userMemoriesActivities.updatedAt,
        },
        params.timeRange,
      ),
      this.buildExactTagFilterCondition(userMemoriesActivities.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesActivities.accessedAt,
        associatedLocations: userMemoriesActivities.associatedLocations,
        associatedObjects: userMemoriesActivities.associatedObjects,
        associatedSubjects: userMemoriesActivities.associatedSubjects,
        capturedAt: userMemoriesActivities.capturedAt,
        createdAt: userMemoriesActivities.createdAt,
        endsAt: userMemoriesActivities.endsAt,
        feedback: userMemoriesActivities.feedback,
        id: userMemoriesActivities.id,
        metadata: userMemoriesActivities.metadata,
        narrative: userMemoriesActivities.narrative,
        notes: userMemoriesActivities.notes,
        startsAt: userMemoriesActivities.startsAt,
        status: userMemoriesActivities.status,
        tags: userMemoriesActivities.tags,
        timezone: userMemoriesActivities.timezone,
        type: userMemoriesActivities.type,
        updatedAt: userMemoriesActivities.updatedAt,
        userId: userMemoriesActivities.userId,
        userMemoryId: userMemoriesActivities.userMemoryId,
      })
      .from(userMemoriesActivities)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
      .where(and(...conditions))
      .orderBy(
        desc(sql`1 - (${cosineDistance(userMemoriesActivities.narrativeVector, embedding)})`),
      )
      .limit(limit);

    return rowsQuery as Promise<UserMemoryActivitiesWithoutVectors[]>;
  }

  private async searchContextsSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    const conditions = [
      eq(userMemoriesContexts.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.status?.length
        ? inArray(userMemoriesContexts.currentStatus, params.status)
        : undefined,
      params.types?.length ? inArray(userMemoriesContexts.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesContexts.capturedAt,
          createdAt: userMemoriesContexts.createdAt,
          updatedAt: userMemoriesContexts.updatedAt,
        },
        params.timeRange,
      ),
      this.buildExactTagFilterCondition(userMemoriesContexts.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const contextCandidates = this.db.$with('semantic_context_candidates').as(
      this.db
        .select({
          accessedAt: userMemoriesContexts.accessedAt,
          associatedObjects: userMemoriesContexts.associatedObjects,
          associatedSubjects: userMemoriesContexts.associatedSubjects,
          capturedAt: userMemoriesContexts.capturedAt,
          createdAt: userMemoriesContexts.createdAt,
          currentStatus: userMemoriesContexts.currentStatus,
          description: userMemoriesContexts.description,
          dedupeRank: sql<number>`
            row_number() over (
              partition by ${userMemoriesContexts.id}
              order by
                1 - (${cosineDistance(userMemoriesContexts.descriptionVector, embedding)}) desc,
                ${userMemoriesContexts.createdAt} desc
            )
          `.as('dedupe_rank'),
          id: userMemoriesContexts.id,
          metadata: userMemoriesContexts.metadata,
          scoreImpact: userMemoriesContexts.scoreImpact,
          scoreUrgency: userMemoriesContexts.scoreUrgency,
          similarity: sql<number>`
            1 - (${cosineDistance(userMemoriesContexts.descriptionVector, embedding)})
          `.as('similarity'),
          tags: userMemoriesContexts.tags,
          title: userMemoriesContexts.title,
          type: userMemoriesContexts.type,
          updatedAt: userMemoriesContexts.updatedAt,
          userId: userMemoriesContexts.userId,
          userMemoryIds: userMemoriesContexts.userMemoryIds,
        })
        .from(userMemoriesContexts)
        .innerJoin(
          userMemories,
          and(
            eq(userMemories.userId, userMemoriesContexts.userId),
            sql<boolean>`
              COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
            `,
          ),
        )
        .where(and(...conditions)),
    );

    const rowsQuery = this.db
      .with(contextCandidates)
      .select({
        accessedAt: contextCandidates.accessedAt,
        associatedObjects: contextCandidates.associatedObjects,
        associatedSubjects: contextCandidates.associatedSubjects,
        capturedAt: contextCandidates.capturedAt,
        createdAt: contextCandidates.createdAt,
        currentStatus: contextCandidates.currentStatus,
        description: contextCandidates.description,
        id: contextCandidates.id,
        metadata: contextCandidates.metadata,
        scoreImpact: contextCandidates.scoreImpact,
        scoreUrgency: contextCandidates.scoreUrgency,
        tags: contextCandidates.tags,
        title: contextCandidates.title,
        type: contextCandidates.type,
        updatedAt: contextCandidates.updatedAt,
        userId: contextCandidates.userId,
        userMemoryIds: contextCandidates.userMemoryIds,
      })
      .from(contextCandidates)
      .where(eq(contextCandidates.dedupeRank, 1))
      .orderBy(desc(contextCandidates.similarity), desc(contextCandidates.createdAt))
      .limit(limit);

    return rowsQuery as Promise<UserMemoryContextsWithoutVectors[]>;
  }

  private async searchExperiencesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    const conditions = [
      eq(userMemoriesExperiences.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.types?.length ? inArray(userMemoriesExperiences.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesExperiences.capturedAt,
          createdAt: userMemoriesExperiences.createdAt,
          updatedAt: userMemoriesExperiences.updatedAt,
        },
        params.timeRange,
      ),
      this.buildExactTagFilterCondition(userMemoriesExperiences.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesExperiences.accessedAt,
        action: userMemoriesExperiences.action,
        capturedAt: userMemoriesExperiences.capturedAt,
        createdAt: userMemoriesExperiences.createdAt,
        id: userMemoriesExperiences.id,
        keyLearning: userMemoriesExperiences.keyLearning,
        metadata: userMemoriesExperiences.metadata,
        possibleOutcome: userMemoriesExperiences.possibleOutcome,
        reasoning: userMemoriesExperiences.reasoning,
        scoreConfidence: userMemoriesExperiences.scoreConfidence,
        situation: userMemoriesExperiences.situation,
        tags: userMemoriesExperiences.tags,
        type: userMemoriesExperiences.type,
        updatedAt: userMemoriesExperiences.updatedAt,
        userId: userMemoriesExperiences.userId,
        userMemoryId: userMemoriesExperiences.userMemoryId,
      })
      .from(userMemoriesExperiences)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesExperiences.userMemoryId))
      .where(and(...conditions))
      .orderBy(
        desc(sql`1 - (${cosineDistance(userMemoriesExperiences.situationVector, embedding)})`),
      )
      .limit(limit);

    return rowsQuery as Promise<UserMemoryExperiencesWithoutVectors[]>;
  }

  private async searchPreferencesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ) {
    const conditions = [
      eq(userMemoriesPreferences.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.types?.length ? inArray(userMemoriesPreferences.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesPreferences.capturedAt,
          createdAt: userMemoriesPreferences.createdAt,
          updatedAt: userMemoriesPreferences.updatedAt,
        },
        params.timeRange,
      ),
      this.buildExactTagFilterCondition(userMemoriesPreferences.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesPreferences.accessedAt,
        capturedAt: userMemoriesPreferences.capturedAt,
        conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
        createdAt: userMemoriesPreferences.createdAt,
        id: userMemoriesPreferences.id,
        metadata: userMemoriesPreferences.metadata,
        scorePriority: userMemoriesPreferences.scorePriority,
        suggestions: userMemoriesPreferences.suggestions,
        tags: userMemoriesPreferences.tags,
        type: userMemoriesPreferences.type,
        updatedAt: userMemoriesPreferences.updatedAt,
        userId: userMemoriesPreferences.userId,
        userMemoryId: userMemoriesPreferences.userMemoryId,
      })
      .from(userMemoriesPreferences)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesPreferences.userMemoryId))
      .where(and(...conditions))
      .orderBy(
        desc(
          sql`1 - (${cosineDistance(userMemoriesPreferences.conclusionDirectivesVector, embedding)})`,
        ),
      )
      .limit(limit);

    return rowsQuery as Promise<UserMemoryPreferencesWithoutVectors[]>;
  }

  private async searchIdentitiesSemantic(
    embedding: number[],
    limit: number,
    params: SearchMemoryParams,
  ): Promise<UserMemoryIdentitiesWithoutVectors[]> {
    const conditions = [
      eq(userMemoriesIdentities.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.relationships?.length
        ? inArray(userMemoriesIdentities.relationship, params.relationships)
        : undefined,
      params.types?.length ? inArray(userMemoriesIdentities.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesIdentities.capturedAt,
          createdAt: userMemoriesIdentities.createdAt,
          episodicDate: userMemoriesIdentities.episodicDate,
          updatedAt: userMemoriesIdentities.updatedAt,
        },
        params.timeRange,
      ),
      this.buildExactTagFilterCondition(userMemoriesIdentities.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesIdentities.accessedAt,
        capturedAt: userMemoriesIdentities.capturedAt,
        createdAt: userMemoriesIdentities.createdAt,
        description: userMemoriesIdentities.description,
        episodicDate: userMemoriesIdentities.episodicDate,
        id: userMemoriesIdentities.id,
        metadata: userMemoriesIdentities.metadata,
        relationship: userMemoriesIdentities.relationship,
        role: userMemoriesIdentities.role,
        tags: userMemoriesIdentities.tags,
        type: userMemoriesIdentities.type,
        updatedAt: userMemoriesIdentities.updatedAt,
        userId: userMemoriesIdentities.userId,
        userMemoryId: userMemoriesIdentities.userMemoryId,
      })
      .from(userMemoriesIdentities)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesIdentities.userMemoryId))
      .where(and(...conditions))
      .orderBy(
        desc(sql`1 - (${cosineDistance(userMemoriesIdentities.descriptionVector, embedding)})`),
      )
      .limit(limit);

    return rowsQuery as Promise<UserMemoryIdentitiesWithoutVectors[]>;
  }

  private async searchActivitiesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const bm25Query = normalizedQuery
      ? sanitizeBm25Query(normalizedQuery, SAFE_BM25_QUERY_OPTIONS)
      : '';
    const conditions = [
      eq(userMemoriesActivities.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.status?.length ? inArray(userMemoriesActivities.status, params.status) : undefined,
      params.types?.length ? inArray(userMemoriesActivities.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesActivities.capturedAt,
          createdAt: userMemoriesActivities.createdAt,
          endsAt: userMemoriesActivities.endsAt,
          startsAt: userMemoriesActivities.startsAt,
          updatedAt: userMemoriesActivities.updatedAt,
        },
        params.timeRange,
      ),
      normalizedQuery
        ? sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query} OR ${userMemoriesActivities.narrative} @@@ ${bm25Query} OR ${userMemoriesActivities.notes} @@@ ${bm25Query} OR ${userMemoriesActivities.feedback} @@@ ${bm25Query})`
        : undefined,
      this.buildExactTagFilterCondition(userMemoriesActivities.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesActivities.accessedAt,
        associatedLocations: userMemoriesActivities.associatedLocations,
        associatedObjects: userMemoriesActivities.associatedObjects,
        associatedSubjects: userMemoriesActivities.associatedSubjects,
        capturedAt: userMemoriesActivities.capturedAt,
        createdAt: userMemoriesActivities.createdAt,
        endsAt: userMemoriesActivities.endsAt,
        feedback: userMemoriesActivities.feedback,
        id: userMemoriesActivities.id,
        metadata: userMemoriesActivities.metadata,
        narrative: userMemoriesActivities.narrative,
        notes: userMemoriesActivities.notes,
        startsAt: userMemoriesActivities.startsAt,
        status: userMemoriesActivities.status,
        tags: userMemoriesActivities.tags,
        timezone: userMemoriesActivities.timezone,
        type: userMemoriesActivities.type,
        updatedAt: userMemoriesActivities.updatedAt,
        userId: userMemoriesActivities.userId,
        userMemoryId: userMemoriesActivities.userMemoryId,
      })
      .from(userMemoriesActivities)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
      .where(and(...conditions))
      .orderBy(desc(userMemoriesActivities.capturedAt), desc(userMemoriesActivities.createdAt))
      .limit(limit);

    return rowsQuery as Promise<UserMemoryActivitiesWithoutVectors[]>;
  }

  private async searchContextsLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const bm25Query = normalizedQuery
      ? sanitizeBm25Query(normalizedQuery, SAFE_BM25_QUERY_OPTIONS)
      : '';
    const conditions = [
      eq(userMemoriesContexts.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.types?.length ? inArray(userMemoriesContexts.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesContexts.capturedAt,
          createdAt: userMemoriesContexts.createdAt,
          updatedAt: userMemoriesContexts.updatedAt,
        },
        params.timeRange,
      ),
      normalizedQuery
        ? sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query} OR ${userMemoriesContexts.title} @@@ ${bm25Query} OR ${userMemoriesContexts.description} @@@ ${bm25Query} OR ${userMemoriesContexts.currentStatus} @@@ ${bm25Query})`
        : undefined,
      this.buildExactTagFilterCondition(userMemoriesContexts.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const contextCandidates = this.db.$with('lexical_context_candidates').as(
      this.db
        .select({
          accessedAt: userMemoriesContexts.accessedAt,
          associatedObjects: userMemoriesContexts.associatedObjects,
          associatedSubjects: userMemoriesContexts.associatedSubjects,
          capturedAt: userMemoriesContexts.capturedAt,
          createdAt: userMemoriesContexts.createdAt,
          currentStatus: userMemoriesContexts.currentStatus,
          dedupeRank: sql<number>`
            row_number() over (
              partition by ${userMemoriesContexts.id}
              order by
                ${userMemoriesContexts.capturedAt} desc,
                ${userMemoriesContexts.createdAt} desc
            )
          `.as('dedupe_rank'),
          description: userMemoriesContexts.description,
          id: userMemoriesContexts.id,
          metadata: userMemoriesContexts.metadata,
          scoreImpact: userMemoriesContexts.scoreImpact,
          scoreUrgency: userMemoriesContexts.scoreUrgency,
          tags: userMemoriesContexts.tags,
          title: userMemoriesContexts.title,
          type: userMemoriesContexts.type,
          updatedAt: userMemoriesContexts.updatedAt,
          userId: userMemoriesContexts.userId,
          userMemoryIds: userMemoriesContexts.userMemoryIds,
        })
        .from(userMemoriesContexts)
        .innerJoin(
          userMemories,
          and(
            eq(userMemories.userId, userMemoriesContexts.userId),
            sql<boolean>`
              COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
            `,
          ),
        )
        .where(and(...conditions)),
    );

    const rowsQuery = this.db
      .with(contextCandidates)
      .select({
        accessedAt: contextCandidates.accessedAt,
        associatedObjects: contextCandidates.associatedObjects,
        associatedSubjects: contextCandidates.associatedSubjects,
        capturedAt: contextCandidates.capturedAt,
        createdAt: contextCandidates.createdAt,
        currentStatus: contextCandidates.currentStatus,
        description: contextCandidates.description,
        id: contextCandidates.id,
        metadata: contextCandidates.metadata,
        scoreImpact: contextCandidates.scoreImpact,
        scoreUrgency: contextCandidates.scoreUrgency,
        tags: contextCandidates.tags,
        title: contextCandidates.title,
        type: contextCandidates.type,
        updatedAt: contextCandidates.updatedAt,
        userId: contextCandidates.userId,
        userMemoryIds: contextCandidates.userMemoryIds,
      })
      .from(contextCandidates)
      .where(eq(contextCandidates.dedupeRank, 1))
      .orderBy(desc(contextCandidates.capturedAt), desc(contextCandidates.createdAt))
      .limit(limit);

    return rowsQuery as Promise<UserMemoryContextsWithoutVectors[]>;
  }

  private async searchExperiencesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const bm25Query = normalizedQuery
      ? sanitizeBm25Query(normalizedQuery, SAFE_BM25_QUERY_OPTIONS)
      : '';
    const conditions = [
      eq(userMemoriesExperiences.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.types?.length ? inArray(userMemoriesExperiences.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesExperiences.capturedAt,
          createdAt: userMemoriesExperiences.createdAt,
          updatedAt: userMemoriesExperiences.updatedAt,
        },
        params.timeRange,
      ),
      normalizedQuery
        ? sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query} OR ${userMemoriesExperiences.situation} @@@ ${bm25Query} OR ${userMemoriesExperiences.keyLearning} @@@ ${bm25Query} OR ${userMemoriesExperiences.action} @@@ ${bm25Query} OR ${userMemoriesExperiences.reasoning} @@@ ${bm25Query} OR ${userMemoriesExperiences.possibleOutcome} @@@ ${bm25Query})`
        : undefined,
      this.buildExactTagFilterCondition(userMemoriesExperiences.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesExperiences.accessedAt,
        action: userMemoriesExperiences.action,
        capturedAt: userMemoriesExperiences.capturedAt,
        createdAt: userMemoriesExperiences.createdAt,
        id: userMemoriesExperiences.id,
        keyLearning: userMemoriesExperiences.keyLearning,
        metadata: userMemoriesExperiences.metadata,
        possibleOutcome: userMemoriesExperiences.possibleOutcome,
        reasoning: userMemoriesExperiences.reasoning,
        scoreConfidence: userMemoriesExperiences.scoreConfidence,
        situation: userMemoriesExperiences.situation,
        tags: userMemoriesExperiences.tags,
        type: userMemoriesExperiences.type,
        updatedAt: userMemoriesExperiences.updatedAt,
        userId: userMemoriesExperiences.userId,
        userMemoryId: userMemoriesExperiences.userMemoryId,
      })
      .from(userMemoriesExperiences)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesExperiences.userMemoryId))
      .where(and(...conditions))
      .orderBy(desc(userMemoriesExperiences.capturedAt), desc(userMemoriesExperiences.createdAt))
      .limit(limit);

    return rowsQuery as Promise<UserMemoryExperiencesWithoutVectors[]>;
  }

  private async searchPreferencesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const bm25Query = normalizedQuery
      ? sanitizeBm25Query(normalizedQuery, SAFE_BM25_QUERY_OPTIONS)
      : '';
    const conditions = [
      eq(userMemoriesPreferences.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.types?.length ? inArray(userMemoriesPreferences.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesPreferences.capturedAt,
          createdAt: userMemoriesPreferences.createdAt,
          updatedAt: userMemoriesPreferences.updatedAt,
        },
        params.timeRange,
      ),
      normalizedQuery
        ? sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query} OR ${userMemoriesPreferences.conclusionDirectives} @@@ ${bm25Query} OR ${userMemoriesPreferences.suggestions} @@@ ${bm25Query})`
        : undefined,
      this.buildExactTagFilterCondition(userMemoriesPreferences.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesPreferences.accessedAt,
        capturedAt: userMemoriesPreferences.capturedAt,
        conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
        createdAt: userMemoriesPreferences.createdAt,
        id: userMemoriesPreferences.id,
        metadata: userMemoriesPreferences.metadata,
        scorePriority: userMemoriesPreferences.scorePriority,
        suggestions: userMemoriesPreferences.suggestions,
        tags: userMemoriesPreferences.tags,
        type: userMemoriesPreferences.type,
        updatedAt: userMemoriesPreferences.updatedAt,
        userId: userMemoriesPreferences.userId,
        userMemoryId: userMemoriesPreferences.userMemoryId,
      })
      .from(userMemoriesPreferences)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesPreferences.userMemoryId))
      .where(and(...conditions))
      .orderBy(desc(userMemoriesPreferences.capturedAt), desc(userMemoriesPreferences.createdAt))
      .limit(limit);

    return rowsQuery as Promise<UserMemoryPreferencesWithoutVectors[]>;
  }

  private async searchIdentitiesLexical(
    query: string | undefined,
    limit: number,
    params: SearchMemoryParams,
  ) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const bm25Query = normalizedQuery
      ? sanitizeBm25Query(normalizedQuery, SAFE_BM25_QUERY_OPTIONS)
      : '';
    const conditions = [
      eq(userMemoriesIdentities.userId, this.userId),
      eq(userMemories.userId, this.userId),
      params.categories?.length
        ? inArray(userMemories.memoryCategory, params.categories)
        : undefined,
      params.relationships?.length
        ? inArray(userMemoriesIdentities.relationship, params.relationships)
        : undefined,
      params.types?.length ? inArray(userMemoriesIdentities.type, params.types) : undefined,
      this.buildTimeRangeCondition(
        {
          capturedAt: userMemoriesIdentities.capturedAt,
          createdAt: userMemoriesIdentities.createdAt,
          episodicDate: userMemoriesIdentities.episodicDate,
          updatedAt: userMemoriesIdentities.updatedAt,
        },
        params.timeRange,
      ),
      normalizedQuery
        ? sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query} OR ${userMemoriesIdentities.description} @@@ ${bm25Query} OR ${userMemoriesIdentities.role} @@@ ${bm25Query})`
        : undefined,
      this.buildExactTagFilterCondition(userMemoriesIdentities.tags, userMemories.tags, params),
    ].filter((condition): condition is SQL => Boolean(condition));

    const rowsQuery = this.db
      .select({
        accessedAt: userMemoriesIdentities.accessedAt,
        capturedAt: userMemoriesIdentities.capturedAt,
        createdAt: userMemoriesIdentities.createdAt,
        description: userMemoriesIdentities.description,
        episodicDate: userMemoriesIdentities.episodicDate,
        id: userMemoriesIdentities.id,
        metadata: userMemoriesIdentities.metadata,
        relationship: userMemoriesIdentities.relationship,
        role: userMemoriesIdentities.role,
        tags: userMemoriesIdentities.tags,
        type: userMemoriesIdentities.type,
        updatedAt: userMemoriesIdentities.updatedAt,
        userId: userMemoriesIdentities.userId,
        userMemoryId: userMemoriesIdentities.userMemoryId,
      })
      .from(userMemoriesIdentities)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesIdentities.userMemoryId))
      .where(and(...conditions))
      .orderBy(desc(userMemoriesIdentities.capturedAt), desc(userMemoriesIdentities.createdAt))
      .limit(limit);

    return rowsQuery as Promise<UserMemoryIdentitiesWithoutVectors[]>;
  }
}
