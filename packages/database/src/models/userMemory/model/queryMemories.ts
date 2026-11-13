import { LayersEnum } from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import { normalizeBm25MatchQuery, SAFE_BM25_QUERY_OPTIONS } from '../../../utils/bm25';
import { inJsonStringArray } from '../../../utils/inJsonStringArray';
import type { UserMemoryModelContext } from './context';
import type { GetMemoriesResult, QueryUserMemoriesParams } from './types';
import { buildTextSearchCondition, isPGliteDatabase } from './utils';

export const queryMemories = async (
  ctx: UserMemoryModelContext,
  params: QueryUserMemoriesParams = {},
): Promise<GetMemoriesResult> => {
  const {
    categories,
    layer,
    order = 'desc',
    page = 1,
    pageSize = 20,
    q,
    sort,
    status,
    tags,
    types,
  } = params;

  const resolvedPage = page ?? 1;
  const resolvedPageSize = pageSize ?? 20;
  const normalizedPage = Math.max(1, resolvedPage);
  const normalizedPageSize = Math.min(Math.max(resolvedPageSize, 1), 100);
  const offset = (normalizedPage - 1) * normalizedPageSize;

  const normalizedQuery = typeof q === 'string' ? q.trim() : '';
  const resolvedLayer = layer ?? LayersEnum.Context;
  const bm25MatchQuery = normalizedQuery
    ? normalizeBm25MatchQuery(normalizedQuery, SAFE_BM25_QUERY_OPTIONS)
    : '';
  const candidateConfig = (() => {
    switch (resolvedLayer) {
      case LayersEnum.Activity: {
        return {
          entity: 'memoryActivities' as const,
          fields: [
            'parent_title',
            'parent_summary',
            'parent_details',
            'narrative',
            'notes',
            'feedback',
          ],
        };
      }
      case LayersEnum.Context: {
        return {
          entity: 'memoryContexts' as const,
          fields: ['parent_text', 'title', 'description', 'current_status'],
        };
      }
      case LayersEnum.Experience: {
        return {
          entity: 'memoryExperiences' as const,
          fields: [
            'parent_title',
            'parent_summary',
            'parent_details',
            'situation',
            'key_learning',
            'action',
          ],
        };
      }
      case LayersEnum.Identity: {
        return {
          entity: 'memoryIdentities' as const,
          fields: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
        };
      }
      case LayersEnum.Preference: {
        return {
          entity: 'memoryPreferences' as const,
          fields: [
            'parent_title',
            'parent_summary',
            'parent_details',
            'conclusion_directives',
            'suggestions',
          ],
        };
      }
      default: {
        return undefined;
      }
    }
  })();
  const candidateResult =
    normalizedQuery && candidateConfig && ctx.ftsSearchCandidateSource?.ftsSearchCandidateEnabled
      ? await ctx.ftsSearchCandidateSource.ftsSearchCandidates({
          entity: candidateConfig.entity,
          filters: {
            ...(categories?.length ? { memoryCategories: categories } : {}),
            ...((resolvedLayer === LayersEnum.Activity || resolvedLayer === LayersEnum.Context) &&
            status?.length
              ? { memoryStatus: status }
              : {}),
            ...(tags?.length ? { memoryTagMatch: 'any' as const, memoryTags: tags } : {}),
            ...(types?.length ? { memoryTypes: types } : {}),
          },
          pagination: {},
          query: { fields: candidateConfig.fields, text: normalizedQuery },
        })
      : undefined;
  const candidateIds = candidateResult?.candidates.map(({ id }) => id);
  // NOTICE:
  // Why this workaround is needed.
  // PGlite-based tests do not provide ParadeDB `pg_search`, so BM25 `@@@`
  // operators fail during local/test execution.
  //
  // Root cause summary.
  // `getTestDB.ts` intentionally skips migrations containing `pg_search` or
  // `bm25` for PGlite compatibility, which means lexical search paths in this
  // model cannot rely on BM25 there.
  //
  // Source/context.
  // See `packages/database/src/core/getTestDB.ts` where those migration
  // statements are filtered out before executing test migrations.
  //
  // Removal condition.
  // Remove this fallback once the test database can execute the same BM25
  // operators/indexes as the production PostgreSQL environment.
  const supportsBm25 = !isPGliteDatabase(ctx.db);

  const conditions: Array<SQL | undefined> = [
    ctx.memoryWhere(userMemories),
    categories && categories.length > 0
      ? inArray(userMemories.memoryCategory, categories)
      : undefined,
    eq(userMemories.memoryLayer, resolvedLayer),
  ];

  const whereClause = and(...conditions);

  const applyOrder = order === 'asc' ? asc : desc;

  const baseSelection = {
    accessedAt: userMemories.accessedAt,
    accessedCount: userMemories.accessedCount,
    createdAt: userMemories.createdAt,
    id: userMemories.id,
    lastAccessedAt: userMemories.lastAccessedAt,
    memoryCategory: userMemories.memoryCategory,
    memoryLayer: userMemories.memoryLayer,
    memoryType: userMemories.memoryType,
    metadata: userMemories.metadata,
    status: userMemories.status,
    tags: userMemories.tags,
    title: userMemories.title,
    updatedAt: userMemories.updatedAt,
    userId: userMemories.userId,
  };

  const buildOrderBy = (
    scoreColumn: SQL | AnyColumn | undefined,
    updatedAtColumn: AnyColumn | SQL,
    createdAtColumn: AnyColumn | SQL,
  ) =>
    [
      scoreColumn ? applyOrder(scoreColumn) : undefined,
      applyOrder(updatedAtColumn),
      applyOrder(createdAtColumn),
    ].filter((item): item is SQL => item !== undefined);

  switch (resolvedLayer) {
    case LayersEnum.Context: {
      const scoreColumn =
        sort === 'scoreUrgency'
          ? userMemoriesContexts.scoreUrgency
          : sort === 'scoreImpact'
            ? userMemoriesContexts.scoreImpact
            : userMemoriesContexts.capturedAt;

      const orderByClauses = buildOrderBy(
        scoreColumn,
        userMemoriesContexts.updatedAt,
        userMemoriesContexts.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.userId, userMemoriesContexts.userId),
        // Use jsonb key-existence (jsonb_exists) to check membership without expanding the array
        sql<boolean>`
          COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
        `,
      );

      const contextFilters: Array<SQL | undefined> = [
        whereClause,
        candidateIds
          ? inJsonStringArray(userMemoriesContexts.id, candidateIds)
          : buildTextSearchCondition({
              bm25MatchQuery,
              groups: [
                {
                  fallbackColumns: [userMemories.title, userMemories.summary, userMemories.details],
                  fields: ['title', 'summary', 'details'],
                  keyColumn: userMemories.id,
                },
                {
                  fallbackColumns: [
                    userMemoriesContexts.title,
                    userMemoriesContexts.description,
                    userMemoriesContexts.currentStatus,
                  ],
                  fields: ['title', 'description', 'current_status'],
                  keyColumn: userMemoriesContexts.id,
                },
              ],
              normalizedQuery,
              supportsBm25,
            }),
        status && status.length > 0
          ? inArray(userMemoriesContexts.currentStatus, status)
          : undefined,
        types && types.length > 0 ? inArray(userMemoriesContexts.type, types) : undefined,
        tags && tags.length > 0
          ? or(
              ...tags.map(
                (tag) =>
                  sql<boolean>`
                    COALESCE(${tag} = ANY(${userMemoriesContexts.tags}), false)
                    OR COALESCE(${tag} = ANY(${userMemories.tags}), false)
                  `,
              ),
            )
          : undefined,
      ];
      const contextWhereClause = and(...contextFilters);

      const rowsQuery = ctx.db
        .select({
          context: {
            accessedAt: userMemoriesContexts.accessedAt,
            createdAt: userMemoriesContexts.createdAt,
            currentStatus: userMemoriesContexts.currentStatus,
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
          },
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesContexts, joinCondition)
        .where(contextWhereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);
      const totalQuery = ctx.db
        .select({ count: sql<number>`COUNT(DISTINCT ${userMemories.id})::int` })
        .from(userMemories)
        .innerJoin(userMemoriesContexts, joinCondition)
        .where(contextWhereClause);

      const [rows, totalResult] = await Promise.all([rowsQuery, totalQuery]);

      return {
        items: rows.map((row) => {
          return {
            context: row.context,
            layer: LayersEnum.Context,
            memory: row.memory,
          };
        }),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: Number(totalResult[0]?.count ?? 0),
      };
    }
    case LayersEnum.Activity: {
      const sortColumn =
        sort === 'startsAt' ? userMemoriesActivities.startsAt : userMemoriesActivities.capturedAt;

      const orderByClauses = buildOrderBy(
        sortColumn,
        userMemoriesActivities.updatedAt,
        userMemoriesActivities.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesActivities.userMemoryId),
        ctx.memoryWhere(userMemoriesActivities),
      );

      const activityFilters: Array<SQL | undefined> = [
        whereClause,
        candidateIds
          ? inJsonStringArray(userMemoriesActivities.id, candidateIds)
          : buildTextSearchCondition({
              bm25MatchQuery,
              groups: [
                {
                  fallbackColumns: [userMemories.title, userMemories.summary, userMemories.details],
                  fields: ['title', 'summary', 'details'],
                  keyColumn: userMemories.id,
                },
                {
                  fallbackColumns: [
                    userMemoriesActivities.narrative,
                    userMemoriesActivities.notes,
                    userMemoriesActivities.feedback,
                  ],
                  fields: ['narrative', 'notes', 'feedback'],
                  keyColumn: userMemoriesActivities.id,
                },
              ],
              normalizedQuery,
              supportsBm25,
            }),
        types && types.length > 0 ? inArray(userMemoriesActivities.type, types) : undefined,
        status && status.length > 0 ? inArray(userMemoriesActivities.status, status) : undefined,
        tags && tags.length > 0
          ? or(
              ...tags.map(
                (tag) =>
                  sql<boolean>`
                    COALESCE(${tag} = ANY(${userMemoriesActivities.tags}), false)
                    OR COALESCE(${tag} = ANY(${userMemories.tags}), false)
                  `,
              ),
            )
          : undefined,
      ];
      const activityWhereClause = and(...activityFilters);

      const rowsQuery = ctx.db
        .select({
          activity: {
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
            startsAt: userMemoriesActivities.startsAt,
            status: userMemoriesActivities.status,
            tags: userMemoriesActivities.tags,
            timezone: userMemoriesActivities.timezone,
            type: userMemoriesActivities.type,
            updatedAt: userMemoriesActivities.updatedAt,
            userId: userMemoriesActivities.userId,
            userMemoryId: userMemoriesActivities.userMemoryId,
          },
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesActivities, joinCondition)
        .where(activityWhereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);
      const totalQuery = ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemories)
        .innerJoin(userMemoriesActivities, joinCondition)
        .where(activityWhereClause);

      const [rows, totalResult] = await Promise.all([rowsQuery, totalQuery]);

      return {
        items: rows.map((row) => {
          return {
            activity: row.activity,
            layer: LayersEnum.Activity,
            memory: row.memory,
          };
        }),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: Number(totalResult[0]?.count ?? 0),
      };
    }
    case LayersEnum.Experience: {
      const scoreColumn =
        sort === 'scoreConfidence'
          ? userMemoriesExperiences.scoreConfidence
          : userMemoriesExperiences.capturedAt;

      const orderByClauses = buildOrderBy(
        scoreColumn,
        userMemoriesExperiences.updatedAt,
        userMemoriesExperiences.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesExperiences.userMemoryId),
        ctx.memoryWhere(userMemoriesExperiences),
      );

      const experienceFilters: Array<SQL | undefined> = [
        whereClause,
        candidateIds
          ? inJsonStringArray(userMemoriesExperiences.id, candidateIds)
          : buildTextSearchCondition({
              bm25MatchQuery,
              groups: [
                {
                  fallbackColumns: [userMemories.title, userMemories.summary, userMemories.details],
                  fields: ['title', 'summary', 'details'],
                  keyColumn: userMemories.id,
                },
                {
                  fallbackColumns: [
                    userMemoriesExperiences.situation,
                    userMemoriesExperiences.keyLearning,
                    userMemoriesExperiences.action,
                  ],
                  fields: ['situation', 'key_learning', 'action'],
                  keyColumn: userMemoriesExperiences.id,
                },
              ],
              normalizedQuery,
              supportsBm25,
            }),
        types && types.length > 0 ? inArray(userMemoriesExperiences.type, types) : undefined,
        tags && tags.length > 0
          ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesExperiences.tags})`))
          : undefined,
      ];
      const experienceWhereClause = and(...experienceFilters);

      const rowsQuery = ctx.db
        .select({
          experience: {
            accessedAt: userMemoriesExperiences.accessedAt,
            action: userMemoriesExperiences.action,
            createdAt: userMemoriesExperiences.createdAt,
            id: userMemoriesExperiences.id,
            keyLearning: userMemoriesExperiences.keyLearning,
            metadata: userMemoriesExperiences.metadata,
            scoreConfidence: userMemoriesExperiences.scoreConfidence,
            situation: userMemoriesExperiences.situation,
            tags: userMemoriesExperiences.tags,
            type: userMemoriesExperiences.type,
            updatedAt: userMemoriesExperiences.updatedAt,
            userId: userMemoriesExperiences.userId,
            userMemoryId: userMemoriesExperiences.userMemoryId,
          },
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesExperiences, joinCondition)
        .where(experienceWhereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);
      const totalQuery = ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemories)
        .innerJoin(userMemoriesExperiences, joinCondition)
        .where(experienceWhereClause);

      const [rows, totalResult] = await Promise.all([rowsQuery, totalQuery]);

      return {
        items: rows.map((row) => {
          return {
            experience: row.experience,
            layer: LayersEnum.Experience,
            memory: row.memory,
          };
        }),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: Number(totalResult[0]?.count ?? 0),
      };
    }
    case LayersEnum.Identity: {
      const orderByClauses = buildOrderBy(
        undefined,
        userMemoriesIdentities.capturedAt,
        userMemoriesIdentities.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesIdentities.userMemoryId),
        ctx.memoryWhere(userMemoriesIdentities),
      );

      const identityFilters: Array<SQL | undefined> = [
        whereClause,
        candidateIds
          ? inJsonStringArray(userMemoriesIdentities.id, candidateIds)
          : buildTextSearchCondition({
              bm25MatchQuery,
              groups: [
                {
                  fallbackColumns: [userMemories.title, userMemories.summary, userMemories.details],
                  fields: ['title', 'summary', 'details'],
                  keyColumn: userMemories.id,
                },
                {
                  fallbackColumns: [
                    userMemoriesIdentities.description,
                    userMemoriesIdentities.role,
                  ],
                  fields: ['description', 'role'],
                  keyColumn: userMemoriesIdentities.id,
                },
              ],
              normalizedQuery,
              supportsBm25,
            }),
        types && types.length > 0 ? inArray(userMemoriesIdentities.type, types) : undefined,
        tags && tags.length > 0
          ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesIdentities.tags})`))
          : undefined,
      ];
      const identityWhereClause = and(...identityFilters);

      const rowsQuery = ctx.db
        .select({
          identity: {
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
            title: userMemories.title,
            type: userMemoriesIdentities.type,
            updatedAt: userMemoriesIdentities.updatedAt,
            userId: userMemoriesIdentities.userId,
            userMemoryId: userMemoriesIdentities.userMemoryId,
          },
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesIdentities, joinCondition)
        .where(identityWhereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);
      const totalQuery = ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemories)
        .innerJoin(userMemoriesIdentities, joinCondition)
        .where(identityWhereClause);

      const [rows, totalResult] = await Promise.all([rowsQuery, totalQuery]);

      return {
        items: rows.map((row) => {
          return {
            identity: row.identity,
            layer: LayersEnum.Identity,
            memory: row.memory,
          };
        }),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: Number(totalResult[0]?.count ?? 0),
      };
    }
    case LayersEnum.Preference: {
      const scoreColumn =
        sort === 'scorePriority'
          ? userMemoriesPreferences.scorePriority
          : userMemoriesPreferences.capturedAt;

      const orderByClauses = buildOrderBy(
        scoreColumn,
        userMemoriesPreferences.updatedAt,
        userMemoriesPreferences.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesPreferences.userMemoryId),
        ctx.memoryWhere(userMemoriesPreferences),
      );

      const preferenceFilters: Array<SQL | undefined> = [
        whereClause,
        candidateIds
          ? inJsonStringArray(userMemoriesPreferences.id, candidateIds)
          : buildTextSearchCondition({
              bm25MatchQuery,
              groups: [
                {
                  fallbackColumns: [userMemories.title, userMemories.summary, userMemories.details],
                  fields: ['title', 'summary', 'details'],
                  keyColumn: userMemories.id,
                },
                {
                  fallbackColumns: [
                    userMemoriesPreferences.conclusionDirectives,
                    userMemoriesPreferences.suggestions,
                  ],
                  fields: ['conclusion_directives', 'suggestions'],
                  keyColumn: userMemoriesPreferences.id,
                },
              ],
              normalizedQuery,
              supportsBm25,
            }),
        types && types.length > 0 ? inArray(userMemoriesPreferences.type, types) : undefined,
        tags && tags.length > 0
          ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesPreferences.tags})`))
          : undefined,
      ];
      const preferenceWhereClause = and(...preferenceFilters);

      const rowsQuery = ctx.db
        .select({
          memory: baseSelection,
          preference: {
            accessedAt: userMemoriesPreferences.accessedAt,
            conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
            createdAt: userMemoriesPreferences.createdAt,
            id: userMemoriesPreferences.id,
            metadata: userMemoriesPreferences.metadata,
            scorePriority: userMemoriesPreferences.scorePriority,
            tags: userMemoriesPreferences.tags,
            type: userMemoriesPreferences.type,
            updatedAt: userMemoriesPreferences.updatedAt,
            userId: userMemoriesPreferences.userId,
            userMemoryId: userMemoriesPreferences.userMemoryId,
          },
        })
        .from(userMemories)
        .innerJoin(userMemoriesPreferences, joinCondition)
        .where(preferenceWhereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);
      const totalQuery = ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemories)
        .innerJoin(userMemoriesPreferences, joinCondition)
        .where(preferenceWhereClause);

      const [rows, totalResult] = await Promise.all([rowsQuery, totalQuery]);

      return {
        items: rows.map((row) => {
          return {
            layer: LayersEnum.Preference,
            memory: row.memory,
            preference: row.preference,
          };
        }),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: Number(totalResult[0]?.count ?? 0),
      };
    }
    default: {
      return {
        items: [],
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: 0,
      };
    }
  }
};
