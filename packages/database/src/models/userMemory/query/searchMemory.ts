import type { SearchMemoryParams } from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';

import { DEFAULT_HYBRID_SEARCH_LIMIT } from './constants';
import type { UserMemoryQueryContext } from './context';
import type {
  HybridSearchLayerMeta,
  RankedSearchCandidate,
  RecommendationScoreBreakdown,
  SearchLayerKey,
  UserMemoryHybridSearchAggregatedResult,
} from './types';
import { normalizeUserMemorySearchQueries, shouldRunUserMemoryLexicalSearch } from './utils';

interface HybridLayerLimitRecord {
  activities?: number;
  contexts?: number;
  experiences?: number;
  identities?: number;
  preferences?: number;
}

const createEmptySearchLayerMeta = (): Record<SearchLayerKey, HybridSearchLayerMeta> => ({
  activities: { hasMore: false, returned: 0, total: 0 },
  contexts: { hasMore: false, returned: 0, total: 0 },
  experiences: { hasMore: false, returned: 0, total: 0 },
  identities: { hasMore: false, returned: 0, total: 0 },
  preferences: { hasMore: false, returned: 0, total: 0 },
});

export const searchMemory = async (
  ctx: UserMemoryQueryContext,
  params: SearchMemoryParams,
  queryEmbeddings: number[][] = [],
): Promise<UserMemoryHybridSearchAggregatedResult> => {
  const appliedQueries = normalizeUserMemorySearchQueries(params.queries);
  const lexicalSearch = shouldRunUserMemoryLexicalSearch(appliedQueries, queryEmbeddings);
  const limits: HybridLayerLimitRecord = {
    activities: params.topK?.activities ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    contexts: params.topK?.contexts ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    experiences: params.topK?.experiences ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    identities: params.topK?.identities ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    preferences: params.topK?.preferences ?? DEFAULT_HYBRID_SEARCH_LIMIT,
  };
  // Experience memory is retired: nothing writes it any more and no surface lists it, so the
  // search never reaches for those rows either — whichever caller asked, whatever it requested.
  const requestedLayers = new Set(
    (params.layers ?? Object.values(LayersEnum)).filter((layer) => {
      if (layer === LayersEnum.Experience) return false;
      switch (layer) {
        case LayersEnum.Activity: {
          return (
            (limits.activities ??
              // v8 ignore start -- unreachable: limits.activities always falls back to DEFAULT_HYBRID_SEARCH_LIMIT
              0) > 0
            // v8 ignore stop
          );
        }
        case LayersEnum.Context: {
          return (
            (limits.contexts ??
              // v8 ignore start -- unreachable: limits.contexts always falls back to DEFAULT_HYBRID_SEARCH_LIMIT
              0) > 0
            // v8 ignore stop
          );
        }
        case LayersEnum.Identity: {
          return (
            (limits.identities ??
              // v8 ignore start -- unreachable: limits.identities always falls back to DEFAULT_HYBRID_SEARCH_LIMIT
              0) > 0
            // v8 ignore stop
          );
        }
        case LayersEnum.Preference: {
          return (
            (limits.preferences ??
              // v8 ignore start -- unreachable: limits.preferences always falls back to DEFAULT_HYBRID_SEARCH_LIMIT
              0) > 0
            // v8 ignore stop
          );
        }
      }
    }),
  );

  const layerMeta = createEmptySearchLayerMeta();

  const [activities, contexts, experiences, identities, preferences] = await Promise.all([
    requestedLayers.has(LayersEnum.Activity)
      ? ctx.searchHybridActivities({
          embeddings: queryEmbeddings,
          lexicalSearch,
          params,
          queries: appliedQueries,
        })
      : Promise.resolve([]),
    requestedLayers.has(LayersEnum.Context)
      ? ctx.searchHybridContexts({
          embeddings: queryEmbeddings,
          lexicalSearch,
          params,
          queries: appliedQueries,
        })
      : Promise.resolve([]),
    requestedLayers.has(LayersEnum.Experience)
      ? // v8 ignore start -- unreachable: requestedLayers filters out LayersEnum.Experience; the pair is ignored because a skipped first arm shifts the second arm's count
        ctx.searchHybridExperiences({
          embeddings: queryEmbeddings,
          lexicalSearch,
          params,
          queries: appliedQueries,
        })
      : Promise.resolve([]),
    // v8 ignore stop
    requestedLayers.has(LayersEnum.Identity)
      ? ctx.searchHybridIdentities({
          embeddings: queryEmbeddings,
          lexicalSearch,
          params,
          queries: appliedQueries,
        })
      : Promise.resolve([]),
    requestedLayers.has(LayersEnum.Preference)
      ? ctx.searchHybridPreferences({
          embeddings: queryEmbeddings,
          lexicalSearch,
          params,
          queries: appliedQueries,
        })
      : Promise.resolve([]),
  ]);

  const ranking: Partial<Record<SearchLayerKey, Record<string, RecommendationScoreBreakdown>>> = {};

  const finalizeLayer = <T extends { id: string }>(
    key: SearchLayerKey,
    items: RankedSearchCandidate<T>[],
  ) => {
    const limit =
      limits[key] ??
      // v8 ignore start -- unreachable: every limits entry is already defaulted
      DEFAULT_HYBRID_SEARCH_LIMIT;
    // v8 ignore stop
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
