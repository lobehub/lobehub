import type { UserMemoryDetail } from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryIdentity,
  UserMemoryPreference,
} from '../../../schemas';
import {
  userMemories,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import { selectNonVectorColumns } from '../../../utils/columns';
import type { UserMemoryModelContext } from './context';

export type ListMemoriesItem<L extends LayersEnum> = L extends LayersEnum.Context
  ? UserMemoryDetail & { context: UserMemoryContext; layer: LayersEnum.Context }
  : L extends LayersEnum.Experience
    ? UserMemoryDetail & { experience: UserMemoryExperience; layer: LayersEnum.Experience }
    : L extends LayersEnum.Identity
      ? UserMemoryDetail & { identity: UserMemoryIdentity; layer: LayersEnum.Identity }
      : L extends LayersEnum.Preference
        ? UserMemoryDetail & { layer: LayersEnum.Preference; preference: UserMemoryPreference }
        : L extends LayersEnum.Activity
          ? UserMemoryDetail & { activity: UserMemoryActivity; layer: LayersEnum.Activity }
          : never;

export interface ListMemoriesParams<L extends LayersEnum> {
  layer?: L;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * NOTICE: internal service / backend / data aggregation use only, for most of the UI related use-cases,
 * please use `queryMemories` method instead.
 */
export const listMemories = async <
  L extends LayersEnum,
  R extends UserMemoryDetail = ListMemoriesItem<L>,
>(
  ctx: UserMemoryModelContext,
  params: ListMemoriesParams<L>,
): Promise<R[]> => {
  const { layer = LayersEnum.Context, order = 'desc', page = 1, pageSize = 20 } = params;

  const normalizedPage = Math.max(1, page ?? 1);
  const normalizedPageSize = Math.min(Math.max(pageSize ?? 20, 1), 100);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const applyOrder = order === 'asc' ? asc : desc;

  const baseSelection = selectNonVectorColumns(userMemories);
  const contextSelection = selectNonVectorColumns(userMemoriesContexts);
  const experienceSelection = selectNonVectorColumns(userMemoriesExperiences);
  const identitySelection = selectNonVectorColumns(userMemoriesIdentities);
  const preferenceSelection = selectNonVectorColumns(userMemoriesPreferences);
  // TODO(@nekomeowww): extract a shared selection for the activity branch.

  const baseConditions: Array<SQL | undefined> = [
    ctx.memoryWhere(userMemories),
    eq(userMemories.memoryLayer, layer),
  ];
  const baseWhere = baseConditions.filter(Boolean) as SQL[];

  const buildOrderBy = (updatedAtColumn: AnyColumn | SQL, createdAtColumn: AnyColumn | SQL) =>
    [applyOrder(updatedAtColumn), applyOrder(createdAtColumn)].filter(
      (item): item is SQL => item !== undefined,
    );

  switch (layer) {
    case LayersEnum.Context: {
      const orderByClauses = buildOrderBy(
        userMemoriesContexts.updatedAt,
        userMemoriesContexts.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.userId, userMemoriesContexts.userId),
        sql<boolean>`
          COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
        `,
      );

      const contextFilters: Array<SQL | undefined> = [
        baseWhere.length
          ? and(...baseWhere)
          : /* v8 ignore next -- unreachable: baseWhere always holds the memoryLayer eq() */ undefined,
      ];
      const contextWhere = contextFilters.filter(Boolean) as SQL[];

      const rows = await ctx.db
        .select({
          context: contextSelection,
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesContexts, joinCondition)
        .where(
          contextWhere.length
            ? and(...contextWhere)
            : /* v8 ignore next -- unreachable: always holds the non-empty baseWhere and() */ undefined,
        )
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        context: row.context,
        layer: LayersEnum.Context,
        memory: row.memory,
      })) as unknown as R[];
    }
    case LayersEnum.Experience: {
      const orderByClauses = buildOrderBy(
        userMemoriesExperiences.updatedAt,
        userMemoriesExperiences.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesExperiences.userMemoryId),
        ctx.memoryWhere(userMemoriesExperiences),
      );

      const experienceFilters: Array<SQL | undefined> = [
        baseWhere.length
          ? and(...baseWhere)
          : /* v8 ignore next -- unreachable: baseWhere always holds the memoryLayer eq() */ undefined,
      ];
      const experienceWhere = experienceFilters.filter(Boolean) as SQL[];

      const rows = await ctx.db
        .select({
          experience: experienceSelection,
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesExperiences, joinCondition)
        .where(
          experienceWhere.length
            ? and(...experienceWhere)
            : /* v8 ignore next -- unreachable: always holds the non-empty baseWhere and() */ undefined,
        )
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        experience: row.experience,
        layer: LayersEnum.Experience,
        memory: row.memory,
      })) as unknown as R[];
    }
    case LayersEnum.Identity: {
      const orderByClauses = buildOrderBy(
        userMemoriesIdentities.updatedAt,
        userMemoriesIdentities.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesIdentities.userMemoryId),
        ctx.memoryWhere(userMemoriesIdentities),
      );

      const identityFilters: Array<SQL | undefined> = [
        baseWhere.length
          ? and(...baseWhere)
          : /* v8 ignore next -- unreachable: baseWhere always holds the memoryLayer eq() */ undefined,
      ];
      const identityWhere = identityFilters.filter(Boolean) as SQL[];

      const rows = await ctx.db
        .select({
          identity: identitySelection,
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesIdentities, joinCondition)
        .where(
          identityWhere.length
            ? and(...identityWhere)
            : /* v8 ignore next -- unreachable: always holds the non-empty baseWhere and() */ undefined,
        )
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        identity: row.identity,
        layer: LayersEnum.Identity,
        memory: row.memory,
      })) as unknown as R[];
    }
    case LayersEnum.Preference: {
      const orderByClauses = buildOrderBy(
        userMemoriesPreferences.updatedAt,
        userMemoriesPreferences.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesPreferences.userMemoryId),
        ctx.memoryWhere(userMemoriesPreferences),
      );

      const preferenceFilters: Array<SQL | undefined> = [
        baseWhere.length
          ? and(...baseWhere)
          : /* v8 ignore next -- unreachable: baseWhere always holds the memoryLayer eq() */ undefined,
      ];
      const preferenceWhere = preferenceFilters.filter(Boolean) as SQL[];

      const rows = await ctx.db
        .select({
          memory: baseSelection,
          preference: preferenceSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesPreferences, joinCondition)
        .where(
          preferenceWhere.length
            ? and(...preferenceWhere)
            : /* v8 ignore next -- unreachable: always holds the non-empty baseWhere and() */ undefined,
        )
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        layer: LayersEnum.Preference,
        memory: row.memory,
        preference: row.preference,
      })) as unknown as R[];
    }
  }

  return [];
};
