import type { LobeChatDatabase } from '@lobechat/database';
import type {
  AgentEvalMemoryItem,
  EvalMemoryReference,
  SearchMemoryParams,
  SearchMemoryResult,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import debug from 'debug';
import type { SQL } from 'drizzle-orm';
import { and, cosineDistance, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import {
  buildBm25MatchCondition,
  buildRetrievalQuery,
  combineEmbeddings,
  DEFAULT_HYBRID_SEARCH_LIMIT,
  hasSearchFilters,
  HYBRID_SEARCH_OVERFETCH_MULTIPLIER,
  type HybridSearchLayerMeta,
  type LayerBaseMemorySignals,
  normalizeUserMemorySearchQueries,
  type RankedSearchCandidate,
  type RecommendationScoreBreakdown,
  scoreHybridCandidates,
  type SearchLayerKey,
  shouldRunSemanticSearch,
  shouldRunUserMemoryLexicalSearch,
  toSearchTags,
} from '@/database/models/userMemory';
import { agentEvalMemories } from '@/database/schemas';

import { tagsOf } from './entries';
import { attemptWhere } from './where';

type Payload = Record<string, any>;
type Item = Record<string, unknown> & { id: string; tags: string[] };

/** The layers the account's search ranks; experience memory is retired there too. */
type SearchedLayer = 'activity' | 'context' | 'identity' | 'preference';

interface LayerSpec {
  layer: SearchedLayer;
  /** The layer fields of the BM25 pass, as `payload` paths the index covers. */
  lexicalFields: string[];
}

const LAYERS: Record<Exclude<SearchLayerKey, 'experiences'>, LayerSpec> = {
  activities: { layer: 'activity', lexicalFields: ['narrative', 'notes', 'feedback'] },
  contexts: { layer: 'context', lexicalFields: ['title', 'description', 'currentStatus'] },
  identities: { layer: 'identity', lexicalFields: ['description', 'role'] },
  preferences: { layer: 'preference', lexicalFields: ['conclusionDirectives', 'suggestions'] },
};

const HEADLINE_FIELDS = ['title', 'summary', 'details'];

const log = debug('lobe-server:agentEvalMemory:search');
const pgSearchByDb = new WeakMap<object, Promise<boolean>>();

/** Whether the database can run the BM25 pass; without pg_search a queried lexical pass is skipped. */
export const hasPgSearch = (db: LobeChatDatabase): Promise<boolean> => {
  let known = pgSearchByDb.get(db);
  if (!known) {
    known = db
      .execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_search'`)
      .then((result) => result.rows.length > 0)
      .catch(() => {
        pgSearchByDb.delete(db);
        log(
          'pg_search detection failed; skipping BM25 for this search and retrying on the next one',
        );
        return false;
      });
    pgSearchByDb.set(db, known);
  }
  return known;
};

const payloadText = (key: string) => sql`${agentEvalMemories.payload}->>${key}`;
/** A payload date as a timestamp; anything that is not one is NULL rather than an error. */
const payloadTimestamp = (key: string) =>
  sql`CASE WHEN ${agentEvalMemories.payload}->>${key} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (${agentEvalMemories.payload}->>${key})::timestamptz END`;

/**
 * The column a time filter reads for a layer, as the account's search maps it
 * (activities also by start and end, identities by episodic date). A seeded
 * entry's clock is its `capturedAt`, which also stands for when it was
 * created and updated.
 */
const timeColumn = (layer: SearchedLayer, field: string): SQL | undefined => {
  switch (field) {
    case 'capturedAt':
    case 'createdAt':
    case 'updatedAt': {
      return sql`${agentEvalMemories.capturedAt}`;
    }
    case 'startsAt':
    case 'endsAt': {
      return layer === 'activity' ? payloadTimestamp(field) : undefined;
    }
    case 'episodicDate': {
      return layer === 'identity' ? payloadTimestamp(field) : undefined;
    }
    default: {
      return undefined;
    }
  }
};

const timeRangeCondition = (
  layer: SearchedLayer,
  timeRange: SearchMemoryParams['timeRange'],
): SQL | undefined => {
  if (!timeRange) return undefined;
  const { end, field = 'capturedAt', start } = timeRange;
  const column = timeColumn(layer, field);
  if (!column) return sql`false`;
  if (start && end) return and(gte(column, start), lte(column, end));
  if (start) return gte(column, start);
  if (end) return lte(column, end);
  return undefined;
};

/** Every requested tag or label must be among the entry's tags (`tagsOf`). */
const tagsCondition = (layer: SearchedLayer, params: SearchMemoryParams): SQL | undefined => {
  const tags = toSearchTags(params);
  if (tags.length === 0) return undefined;
  const has = (tag: string) =>
    layer === 'activity'
      ? sql<boolean>`CASE WHEN jsonb_typeof(${agentEvalMemories.payload}->'tags') = 'array' THEN COALESCE(${agentEvalMemories.payload}->'tags' ? ${tag}, false) ELSE COALESCE(${agentEvalMemories.tags} ? ${tag}, false) END`
      : sql<boolean>`COALESCE(${agentEvalMemories.tags} ? ${tag}, false)`;
  return and(...tags.map(has));
};

/**
 * The filters of one layer, read from the columns the account's search reads
 * on its own tables: category from the entry, status / type / relationship
 * from the layer part, with the defaults the Memory tool writes there.
 */
const layerConditions = (layer: SearchedLayer, params: SearchMemoryParams): SQL[] => {
  const type =
    layer === 'preference'
      ? sql`${agentEvalMemories.memoryType}`
      : layer === 'activity'
        ? sql`COALESCE(${agentEvalMemories.payload}->>'type', 'other')`
        : payloadText('type');
  return [
    eq(agentEvalMemories.layer, layer),
    params.categories?.length
      ? inArray(agentEvalMemories.memoryCategory, params.categories)
      : undefined,
    params.status?.length && layer === 'activity'
      ? inArray(sql`COALESCE(${agentEvalMemories.payload}->>'status', 'pending')`, params.status)
      : undefined,
    params.status?.length && layer === 'context'
      ? inArray(payloadText('currentStatus'), params.status)
      : undefined,
    params.relationships?.length && layer === 'identity'
      ? inArray(payloadText('relationship'), params.relationships)
      : undefined,
    params.types?.length ? inArray(type, params.types) : undefined,
    timeRangeCondition(layer, params.timeRange),
    tagsCondition(layer, params),
  ].filter((condition): condition is SQL => Boolean(condition));
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * An attempt row as the account's search returns the layer's row: the same
 * fields, so the Memory tool formats it the same and the ranking reads the
 * same words from it. Its clock is the entry's `capturedAt` throughout.
 */
export const toSearchItem = (row: AgentEvalMemoryItem, userId: string): Item => {
  const p = row.payload as Payload;
  const common = {
    accessedAt: row.capturedAt,
    capturedAt: row.capturedAt,
    createdAt: row.capturedAt,
    id: row.id,
    tags: tagsOf(row),
    updatedAt: row.capturedAt,
    userId,
  };
  switch (row.layer) {
    case 'preference': {
      const suggestions = Array.isArray(p.suggestions)
        ? p.suggestions.length > 0
          ? p.suggestions.join('\n')
          : null
        : (p.suggestions ?? null);
      return {
        ...common,
        appliesToEntityId: null,
        conclusionDirectives: p.conclusionDirectives ?? row.summary ?? null,
        evidenceCount: 1,
        evidenceSource: null,
        holderEntityId: null,
        lastEvidenceAt: null,
        metadata: {
          appContext: p.appContext ?? null,
          extractedScopes: p.extractedScopes ?? null,
          originContext: p.originContext ?? null,
        },
        scope: null,
        scorePriority: p.scorePriority ?? null,
        suggestions,
        type: row.memoryType ?? p.type ?? null,
        userMemoryId: row.id,
      };
    }
    case 'context': {
      return {
        ...common,
        associatedObjects: p.associatedObjects ?? [],
        associatedSubjects: p.associatedSubjects ?? [],
        currentStatus: p.currentStatus ?? null,
        description: p.description ?? row.summary ?? null,
        firstSeenAt: null,
        lastEvidenceAt: null,
        metadata: {},
        nextSteps: null,
        now: null,
        openQuestions: null,
        scoreImpact: p.scoreImpact ?? null,
        scoreUrgency: p.scoreUrgency ?? null,
        synthesizedAt: null,
        title: p.title ?? row.title ?? null,
        type: p.type ?? null,
        userMemoryId: row.id,
        userMemoryIds: [row.id],
      };
    }
    case 'activity': {
      return {
        ...common,
        associatedLocations: p.associatedLocations ?? null,
        associatedObjects: p.associatedObjects ?? [],
        associatedSubjects: p.associatedSubjects ?? [],
        dossierId: null,
        endsAt: toDate(p.endsAt),
        feedback: p.feedback ?? null,
        injectable: true,
        metadata: p.metadata ?? null,
        narrative: p.narrative ?? row.summary ?? null,
        notes: p.notes ?? null,
        startsAt: toDate(p.startsAt),
        status: p.status ?? 'pending',
        timezone: p.timezone ?? null,
        type: p.type ?? 'other',
        userMemoryId: row.id,
      };
    }
    case 'experience': {
      return {
        ...common,
        action: p.action ?? null,
        keyLearning: p.keyLearning ?? null,
        metadata: null,
        possibleOutcome: p.possibleOutcome ?? null,
        reasoning: p.reasoning ?? null,
        scoreConfidence: p.scoreConfidence ?? null,
        situation: p.situation ?? row.summary ?? null,
        type: p.type ?? row.memoryType ?? null,
        userMemoryId: row.id,
      };
    }
    default: {
      const metadata: Record<string, unknown> = {};
      if (p.scoreConfidence !== null && p.scoreConfidence !== undefined) {
        metadata.scoreConfidence = p.scoreConfidence;
      }
      if (p.sourceEvidence !== null && p.sourceEvidence !== undefined) {
        metadata.sourceEvidence = p.sourceEvidence;
      }
      return {
        ...common,
        description: p.description ?? row.summary ?? null,
        entityId: null,
        episodicDate: toDate(p.episodicDate),
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        relationship: p.relationship ?? null,
        role: p.role ?? null,
        type: p.type ?? row.memoryType ?? null,
        userMemoryId: row.id,
      };
    }
  }
};

export interface SearchEvalMemoryOptions {
  db: LobeChatDatabase;
  /** Normalized parameters with the effort's per-layer `topK` already resolved. */
  params: SearchMemoryParams;
  queryEmbeddings: number[][];
  reference: EvalMemoryReference;
  userId: string;
}

/**
 * The account's hybrid Memory search, run over an attempt's own entries. Per
 * layer it takes the same two candidate passes the account's search takes on
 * its tables (the nearest entries by the layer's vector; the newest entries
 * whose words all match, through the same BM25 index definition), merges them
 * and ranks them with the account's scorer, so the same entries come back in
 * the same order for the same query. Without pg_search a queried lexical pass
 * cannot run and is left out; the filter-only pass and the semantic pass still
 * run.
 */
export const searchEvalMemory = async (
  options: SearchEvalMemoryOptions,
): Promise<SearchMemoryResult> => {
  const { db, params, queryEmbeddings, reference, userId } = options;
  const appliedQueries = normalizeUserMemorySearchQueries(params.queries);
  const lexicalSearch = shouldRunUserMemoryLexicalSearch(appliedQueries, queryEmbeddings);
  const retrievalQuery = buildRetrievalQuery(appliedQueries);
  const semanticEmbedding = combineEmbeddings(queryEmbeddings);
  const semanticSearch =
    !!semanticEmbedding && shouldRunSemanticSearch(appliedQueries.length, queryEmbeddings.length);
  const unembedded = appliedQueries.length > 0 && !semanticEmbedding;
  const bm25 = retrievalQuery && lexicalSearch ? await hasPgSearch(db) : false;
  const limits: Record<SearchLayerKey, number> = {
    activities: params.topK?.activities ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    contexts: params.topK?.contexts ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    experiences: params.topK?.experiences ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    identities: params.topK?.identities ?? DEFAULT_HYBRID_SEARCH_LIMIT,
    preferences: params.topK?.preferences ?? DEFAULT_HYBRID_SEARCH_LIMIT,
  };
  const requestedLayers = new Set(
    (params.layers ?? Object.values(LayersEnum)).map(String).filter((layer) => {
      switch (layer) {
        case LayersEnum.Activity: {
          return limits.activities > 0;
        }
        case LayersEnum.Context: {
          return limits.contexts > 0;
        }
        case LayersEnum.Identity: {
          return limits.identities > 0;
        }
        case LayersEnum.Preference: {
          return limits.preferences > 0;
        }
        default: {
          return false;
        }
      }
    }),
  );

  const own = attemptWhere(userId, reference);

  const searchLayer = async (
    key: Exclude<SearchLayerKey, 'experiences'>,
  ): Promise<RankedSearchCandidate<Item>[]> => {
    const spec = LAYERS[key];
    if (!requestedLayers.has(spec.layer)) return [];
    const limit = limits[key] * HYBRID_SEARCH_OVERFETCH_MULTIPLIER;
    const conditions = layerConditions(spec.layer, params);

    // Simplified path, when the account has no usable embedding model: an
    // attempt holds a handful of entries, so instead of the nearest ones every
    // entry of the layer is a candidate, newest first, and the scorer ranks
    // them by the query's words and recency.
    const semanticLists: AgentEvalMemoryItem[][] = unembedded
      ? [
          await db
            .select()
            .from(agentEvalMemories)
            .where(and(own, ...conditions))
            .orderBy(desc(agentEvalMemories.capturedAt), desc(agentEvalMemories.createdAt))
            .limit(limit),
        ]
      : semanticSearch
        ? [
            await db
              .select()
              .from(agentEvalMemories)
              .where(and(own, ...conditions))
              .orderBy(
                desc(sql`1 - (${cosineDistance(agentEvalMemories.embedding, semanticEmbedding!)})`),
                ...(spec.layer === 'context' ? [desc(agentEvalMemories.createdAt)] : []),
              )
              .limit(limit),
          ]
        : [];

    const lexicalLists: AgentEvalMemoryItem[][] =
      lexicalSearch && (retrievalQuery || hasSearchFilters(params)) && (!retrievalQuery || bm25)
        ? [
            await db
              .select()
              .from(agentEvalMemories)
              .where(
                and(
                  own,
                  ...conditions,
                  retrievalQuery
                    ? buildBm25MatchCondition(retrievalQuery, [
                        {
                          fields: [
                            ...HEADLINE_FIELDS,
                            ...spec.lexicalFields.map((field) => `payload.${field}`),
                          ],
                          keyColumn: agentEvalMemories.id,
                        },
                      ])
                    : undefined,
                ),
              )
              .orderBy(desc(agentEvalMemories.capturedAt), desc(agentEvalMemories.createdAt))
              .limit(limit),
          ]
        : [];

    const items = new Map<string, Item>();
    const baseSignals = new Map<string, LayerBaseMemorySignals>();
    for (const row of [...semanticLists.flat(), ...lexicalLists.flat()]) {
      if (items.has(row.id)) continue;
      items.set(row.id, toSearchItem(row, userId));
      baseSignals.set(row.id, {
        categories: row.memoryCategory ? [row.memoryCategory] : [],
        memoryIds: [row.id],
        tags: tagsOf(row),
        times: [row.capturedAt.getTime()],
      });
    }
    const asItems = (rows: AgentEvalMemoryItem[]) => rows.map((row) => items.get(row.id)!);

    return scoreHybridCandidates<Item>({
      baseSignals,
      items: [...items.values()],
      lexicalLists: lexicalLists.map(asItems),
      // Same as the account's Memory (`searchHybrid*`): a query too long for
      // the lexical pass is not fuzzy-matched either.
      queries: lexicalSearch ? appliedQueries : [],
      queryParams: params,
      semanticLists: semanticLists.map(asItems),
    });
  };

  const [activities, contexts, identities, preferences] = await Promise.all([
    searchLayer('activities'),
    searchLayer('contexts'),
    searchLayer('identities'),
    searchLayer('preferences'),
  ]);

  const layerMeta: Record<SearchLayerKey, HybridSearchLayerMeta> = {
    activities: { hasMore: false, returned: 0, total: 0 },
    contexts: { hasMore: false, returned: 0, total: 0 },
    experiences: { hasMore: false, returned: 0, total: 0 },
    identities: { hasMore: false, returned: 0, total: 0 },
    preferences: { hasMore: false, returned: 0, total: 0 },
  };
  const ranking: Partial<Record<SearchLayerKey, Record<string, RecommendationScoreBreakdown>>> = {};
  const finalizeLayer = (key: SearchLayerKey, ranked: RankedSearchCandidate<Item>[]) => {
    const limit = limits[key];
    const sorted = ranked.sort((left, right) => right.score.final - left.score.final);
    const selected = sorted.slice(0, limit);
    ranking[key] = Object.fromEntries(selected.map((entry) => [entry.item.id, entry.score]));
    layerMeta[key] = {
      hasMore: sorted.length > limit,
      returned: selected.length,
      total: sorted.length,
    };
    return selected.map((entry) => entry.item);
  };

  return {
    activities: finalizeLayer('activities', activities),
    contexts: finalizeLayer('contexts', contexts),
    experiences: finalizeLayer('experiences', []),
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
  } as unknown as SearchMemoryResult;
};
