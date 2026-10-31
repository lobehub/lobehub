import { RelationshipEnum } from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import { userMemories, userMemoriesIdentities } from '../../../schemas';
import type { UserMemoryModelContext } from './context';
import type {
  QueryIdentityRolesParams,
  QueryIdentityRolesResult,
  QueryTagsParams,
  QueryTagsResult,
} from './types';

export const queryTags = async (
  ctx: UserMemoryModelContext,
  params: QueryTagsParams = {},
): Promise<QueryTagsResult[]> => {
  const { layers, page = 1, size = 10 } = params;
  const offset = (page - 1) * size;

  const conditions = [ctx.memoryWhere(userMemories)];
  if (layers && layers.length > 0) {
    conditions.push(inArray(userMemories.memoryLayer, layers));
  }

  const unnestedTags = ctx.db.$with('unnested_tags').as(
    ctx.db
      .select({
        tag: sql<string>`UNNEST(${userMemories.tags})`.as('tag'),
      })
      .from(userMemories)
      .where(and(...conditions)),
  );

  const result = await ctx.db
    .with(unnestedTags)
    .select({
      count: sql<number>`COUNT(${unnestedTags.tag})::int`.as('count'),
      tag: unnestedTags.tag,
    })
    .from(unnestedTags)
    .where(and(isNotNull(unnestedTags.tag), ne(unnestedTags.tag, '')))
    .groupBy(unnestedTags.tag)
    .orderBy(desc(sql<number>`count`))
    .limit(size)
    .offset(offset);

  return result as QueryTagsResult[];
};

export const queryIdentityRoles = async (
  ctx: UserMemoryModelContext,
  params: QueryIdentityRolesParams = {},
): Promise<QueryIdentityRolesResult> => {
  const { page = 1, size = 10 } = params;
  const offset = (page - 1) * size;

  const identityConditions = [
    ctx.memoryWhere(userMemoriesIdentities),
    eq(userMemoriesIdentities.relationship, RelationshipEnum.Self),
  ];

  const identityTags = ctx.db.$with('identity_tags').as(
    ctx.db
      .select({
        tag: sql<string>`UNNEST(${userMemoriesIdentities.tags})`.as('tag'),
      })
      .from(userMemoriesIdentities)
      .where(and(...identityConditions)),
  );

  const [tags, roles] = await Promise.all([
    ctx.db
      .with(identityTags)
      .select({
        count: sql<number>`COUNT(${identityTags.tag})::int`.as('count'),
        tag: identityTags.tag,
      })
      .from(identityTags)
      .where(and(isNotNull(identityTags.tag), ne(identityTags.tag, '')))
      .groupBy(identityTags.tag)
      .orderBy(desc(sql<number>`count`))
      .limit(size)
      .offset(offset),
    ctx.db
      .select({
        count: sql<number>`COUNT(${userMemoriesIdentities.role})::int`.as('count'),
        role: userMemoriesIdentities.role,
      })
      .from(userMemoriesIdentities)
      .where(
        and(
          ...identityConditions,
          isNotNull(userMemoriesIdentities.role),
          ne(userMemoriesIdentities.role, ''),
        ),
      )
      .groupBy(userMemoriesIdentities.role)
      .orderBy(desc(sql<number>`count`))
      .limit(size)
      .offset(offset),
  ]);

  return {
    roles: roles as QueryIdentityRolesResult['roles'],
    tags: tags as QueryIdentityRolesResult['tags'],
  };
};
