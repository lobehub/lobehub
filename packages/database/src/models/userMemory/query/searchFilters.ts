import type { SearchMemoryParams } from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, gte, inArray, lte, sql } from 'drizzle-orm';

import { userMemories } from '../../../schemas';
import { DEFAULT_HYBRID_SEARCH_LIMIT } from './constants';
import type { UserMemoryQueryContext } from './context';
import type { LayerBaseMemorySignals, SearchLayerKey } from './types';
import { coerceDate } from './utils';

const HYBRID_SEARCH_OVERFETCH_MULTIPLIER = 3;

export function getSearchLimit(key: SearchLayerKey, params: SearchMemoryParams) {
  return params.topK?.[key] ?? DEFAULT_HYBRID_SEARCH_LIMIT;
}

export function getSearchOverfetchLimit(
  ctx: UserMemoryQueryContext,
  key: SearchLayerKey,
  params: SearchMemoryParams,
) {
  const layerLimit = ctx.getSearchLimit(key, params);
  if (layerLimit <= 0) return 0;

  return layerLimit * HYBRID_SEARCH_OVERFETCH_MULTIPLIER;
}

export function buildTimeRangeCondition(
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

export function collectCandidateMemoryIds(item: {
  userMemoryId?: string | null;
  userMemoryIds?: string[] | null;
}) {
  if (Array.isArray(item.userMemoryIds)) {
    return item.userMemoryIds.filter(Boolean);
  }

  return item.userMemoryId ? [item.userMemoryId] : [];
}

export async function loadBaseSignals<
  T extends { id: string; userMemoryId?: string | null; userMemoryIds?: string[] | null },
>(ctx: UserMemoryQueryContext, items: T[]) {
  const memoryIds = [...new Set(items.flatMap((item) => ctx.collectCandidateMemoryIds(item)))];
  if (memoryIds.length === 0) {
    return new Map<string, LayerBaseMemorySignals>();
  }

  const baseMemories = await ctx.db
    .select({
      capturedAt: userMemories.capturedAt,
      createdAt: userMemories.createdAt,
      id: userMemories.id,
      memoryCategory: userMemories.memoryCategory,
      tags: userMemories.tags,
      updatedAt: userMemories.updatedAt,
    })
    .from(userMemories)
    .where(and(ctx.memoryWhere(userMemories), inArray(userMemories.id, memoryIds)));

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
      const itemMemoryIds = ctx.collectCandidateMemoryIds(item);
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

export function hasSearchFilters(params: SearchMemoryParams) {
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

export function shouldRunSemanticSearch(queryCount: number, embeddingsCount: number) {
  return queryCount > 0 && embeddingsCount > 0;
}

export function toSearchTags(params: SearchMemoryParams) {
  return [...new Set([...(params.tags ?? []), ...(params.labels ?? [])])];
}

export function buildExactTagFilterCondition(
  ctx: UserMemoryQueryContext,
  layerTags: AnyColumn,
  baseTags: AnyColumn,
  params: SearchMemoryParams,
) {
  const tags = ctx.toSearchTags(params);
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
