import type { SearchMemoryParams } from '@lobechat/types';

import type {
  FtsSearchBackendEntity,
  FtsSearchBackendFilters,
} from '../../../repositories/ftsSearch';
import type { UserMemoryQueryContext } from './context';

export function buildCandidateFilters(
  ctx: UserMemoryQueryContext,
  entity: FtsSearchBackendEntity,
  params: SearchMemoryParams,
): FtsSearchBackendFilters {
  const memoryTags = ctx.toSearchTags(params);

  return {
    ...(params.categories?.length ? { memoryCategories: params.categories } : {}),
    ...(entity === 'memoryIdentities' && params.relationships?.length
      ? { memoryRelationships: params.relationships }
      : {}),
    ...((entity === 'memoryActivities' || entity === 'memoryContexts') && params.status?.length
      ? { memoryStatus: params.status }
      : {}),
    ...(memoryTags.length ? { memoryTags } : {}),
    ...(params.timeRange ? { memoryTimeRange: params.timeRange } : {}),
    ...(params.types?.length ? { memoryTypes: params.types } : {}),
  };
}

export async function fetchFtsSearchCandidates(
  ctx: UserMemoryQueryContext,
  params: {
    entity: FtsSearchBackendEntity;
    fields: string[];
    limit: number;
    query: string;
    searchParams: SearchMemoryParams;
  },
) {
  if (!ctx.ftsSearchCandidateSource?.ftsSearchCandidateEnabled) return undefined;

  const { candidates } = await ctx.ftsSearchCandidateSource.ftsSearchCandidates({
    entity: params.entity,
    filters: ctx.buildCandidateFilters(params.entity, params.searchParams),
    pagination: { limit: params.limit },
    query: { fields: params.fields, text: params.query },
  });

  return candidates.map(({ id }) => id);
}

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
