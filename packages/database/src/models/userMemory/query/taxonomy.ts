import type {
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  SearchMemoryParams,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryQueryContext } from './context';

const DEFAULT_TAXONOMY_LIMIT = 20;

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

export interface LayerScalarAggregationConfig {
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

export const queryTaxonomyOptions = async (
  ctx: UserMemoryQueryContext,
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
    result.categories = await ctx.aggregateBaseMemoryOptions({
      column: userMemories.memoryCategory,
      layers: params.layers,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.categories = result.categories.length >= limit;
  }

  if (include.has('tags')) {
    result.tags = await ctx.aggregateBaseArrayOptions({
      column: userMemories.tags,
      layers: params.layers,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.tags = result.tags.length >= limit;
  }

  if (include.has('labels')) {
    result.labels = await ctx.aggregateLayerLabels({
      layers: params.layers,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.labels = result.labels.length >= limit;
  }

  if (include.has('types')) {
    result.types = await ctx.aggregateLayerTypes({
      layers: params.layers,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.types = result.types.length >= limit;
  }

  if (include.has('statuses')) {
    result.statuses = await ctx.aggregateStatuses({
      layers: params.layers,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.statuses = result.statuses.length >= limit;
  }

  if (include.has('relationships')) {
    result.relationships = await ctx.aggregateIdentityValueOptions({
      column: userMemoriesIdentities.relationship,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.relationships = result.relationships.length >= limit;
  }

  if (include.has('roles')) {
    result.roles = await ctx.aggregateIdentityValueOptions({
      column: userMemoriesIdentities.role,
      limit,
      q: params.q,
      timeRange: params.timeRange,
    });
    result.hasMore.roles = result.roles.length >= limit;
  }

  return result;
};

export async function aggregateBaseMemoryOptions(
  ctx: UserMemoryQueryContext,
  params: {
    column: typeof userMemories.memoryCategory | typeof userMemories.memoryType;
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
): Promise<QueryTaxonomyOptionsResult['categories']> {
  const { column, layers, limit, q, timeRange } = params;
  const conditions = [
    ctx.memoryWhere(userMemories),
    layers?.length ? inArray(userMemories.memoryLayer, layers) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemories.capturedAt,
        createdAt: userMemories.createdAt,
        updatedAt: userMemories.updatedAt,
      },
      timeRange,
    ),
    buildContainsCondition(column, q),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
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

export async function aggregateBaseArrayOptions(
  ctx: UserMemoryQueryContext,
  params: {
    column: typeof userMemories.tags;
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
): Promise<QueryTaxonomyOptionsResult['tags']> {
  const { column, layers, limit, q, timeRange } = params;
  const conditions = [
    ctx.memoryWhere(userMemories),
    layers?.length ? inArray(userMemories.memoryLayer, layers) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemories.capturedAt,
        createdAt: userMemories.createdAt,
        updatedAt: userMemories.updatedAt,
      },
      timeRange,
    ),
  ].filter((condition): condition is SQL => Boolean(condition));

  const unnestedTags = ctx.db.$with('unnested_memory_tags').as(
    ctx.db
      .select({ value: sql<string>`UNNEST(${column})`.as('value') })
      .from(userMemories)
      .where(and(...conditions)),
  );

  const rowsQuery = ctx.db
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

export async function aggregateLayerArrayValues(
  ctx: UserMemoryQueryContext,
  params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
) {
  const configs = buildLayerArrayAggregationConfigs().filter(
    (config) => !params.layers?.length || params.layers.includes(config.layer),
  );

  const rows = await Promise.all(
    configs.map(async (config) => {
      const unnested = ctx.db.$with(config.cteName).as(
        ctx.db
          .select({ value: sql<string>`UNNEST(${config.column})`.as('value') })
          .from(config.table)
          .where(
            and(
              eq(config.userIdColumn, ctx.userId),
              ctx.buildTimeRangeCondition(config.timeRangeColumns, params.timeRange),
            ),
          ),
      );

      return (await ctx.db
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

export async function aggregateLayerLabels(
  ctx: UserMemoryQueryContext,
  params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
): Promise<QueryTaxonomyOptionsResult['labels']> {
  return ctx.aggregateLayerArrayValues(params);
}

export async function aggregateTypedLayerValues(
  ctx: UserMemoryQueryContext,
  params: {
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
  },
) {
  const { column, layer, limit, q, table, timeRange, timeRangeColumns, userIdColumn } = params;

  const rowsQuery = ctx.db
    .select({
      count: sql<number>`COUNT(*)::int`.as('count'),
      layer: sql<LayersEnum>`${layer}`.as('layer'),
      value: column as AnyColumn & SQL,
    })
    .from(table)
    .where(
      and(
        eq(userIdColumn, ctx.userId),
        ctx.buildTimeRangeCondition(timeRangeColumns, timeRange),
        buildContainsCondition(column, q),
      ),
    )
    .groupBy(column as AnyColumn & SQL)
    .orderBy(desc(sql<number>`COUNT(*)::int`), asc(column as AnyColumn & SQL))
    .limit(limit);

  return (await rowsQuery) as Array<{ count: number; layer: LayersEnum; value: string | null }>;
}

export async function aggregateScalarLayerValues(
  ctx: UserMemoryQueryContext,
  params: {
    configs: LayerScalarAggregationConfig[];
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
) {
  const rows = await Promise.all(
    params.configs
      .filter((config) => !params.layers?.length || params.layers.includes(config.layer))
      .map((config) =>
        ctx.aggregateTypedLayerValues({
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

export async function aggregateLayerTypes(
  ctx: UserMemoryQueryContext,
  params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
): Promise<QueryTaxonomyOptionsResult['types']> {
  return ctx.aggregateScalarLayerValues({
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

export async function aggregateStatuses(
  ctx: UserMemoryQueryContext,
  params: {
    layers?: LayersEnum[];
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
): Promise<QueryTaxonomyOptionsResult['statuses']> {
  return ctx.aggregateScalarLayerValues({
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

export async function aggregateIdentityValueOptions(
  ctx: UserMemoryQueryContext,
  params: {
    column: typeof userMemoriesIdentities.relationship | typeof userMemoriesIdentities.role;
    limit: number;
    q?: string;
    timeRange?: SearchMemoryParams['timeRange'];
  },
): Promise<QueryTaxonomyOptionsResult['relationships']> {
  const { column, limit, q, timeRange } = params;
  const rows = await ctx.db
    .select({
      count: sql<number>`COUNT(*)::int`.as('count'),
      value: column,
    })
    .from(userMemoriesIdentities)
    .where(
      and(
        ctx.memoryWhere(userMemoriesIdentities),
        ctx.buildTimeRangeCondition(
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
