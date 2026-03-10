import type { IdentityListParams, IdentityListResult } from '@lobechat/types';
import { RelationshipEnum } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import type { NewUserMemoryIdentity, UserMemoryIdentity } from '../../schemas';
import { userMemories, userMemoriesIdentities } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class UserMemoryIdentityModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewUserMemoryIdentity, 'userId'>) => {
    const [result] = await this.db
      .insert(userMemoriesIdentities)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const identity = await tx.query.userMemoriesIdentities.findFirst({
        where: and(
          eq(userMemoriesIdentities.id, id),
          eq(userMemoriesIdentities.userId, this.userId),
        ),
      });

      if (!identity || !identity.userMemoryId) {
        return { success: false };
      }

      // Delete the base user memory (cascade will handle the identity)
      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, identity.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return { success: true };
    });
  };

  deleteAll = async () => {
    return this.db
      .delete(userMemoriesIdentities)
      .where(eq(userMemoriesIdentities.userId, this.userId));
  };

  query = async (limit = 50) => {
    return this.db.query.userMemoriesIdentities.findMany({
      limit,
      orderBy: [desc(userMemoriesIdentities.capturedAt)],
      where: eq(userMemoriesIdentities.userId, this.userId),
    });
  };

  /**
   * Query identity list with pagination, search, and sorting
   * Returns a flat structure optimized for frontend display
   */
  queryList = async (params: IdentityListParams = {}): Promise<IdentityListResult> => {
    const { order = 'desc', page = 1, pageSize = 20, q, relationships, sort, tags, types } = params;

    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const normalizedQuery = typeof q === 'string' ? q.trim() : '';

    // Build WHERE conditions
    const conditions: Array<SQL | undefined> = [
      eq(userMemoriesIdentities.userId, this.userId),
      // Full-text search across title, description, role
      normalizedQuery
        ? or(
            ilike(userMemories.title, `%${normalizedQuery}%`),
            ilike(userMemoriesIdentities.description, `%${normalizedQuery}%`),
            ilike(userMemoriesIdentities.role, `%${normalizedQuery}%`),
          )
        : undefined,
      types && types.length > 0 ? inArray(userMemoriesIdentities.type, types) : undefined,
      // Default to 'self' relationship if not specified
      relationships && relationships.length > 0
        ? inArray(userMemoriesIdentities.relationship, relationships)
        : eq(userMemoriesIdentities.relationship, RelationshipEnum.Self),
      tags && tags.length > 0
        ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesIdentities.tags})`))
        : undefined,
    ];

    const filters = conditions.filter((condition): condition is SQL => condition !== undefined);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Build ORDER BY
    const applyOrder = order === 'asc' ? asc : desc;
    const sortColumn =
      sort === 'type' ? userMemoriesIdentities.type : userMemoriesIdentities.capturedAt;

    const orderByClauses = [
      applyOrder(sortColumn),
      applyOrder(userMemoriesIdentities.updatedAt),
      applyOrder(userMemoriesIdentities.createdAt),
    ];

    // JOIN condition
    const joinCondition = and(
      eq(userMemories.id, userMemoriesIdentities.userMemoryId),
      eq(userMemories.userId, this.userId),
    );

    // Execute queries in parallel
    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          capturedAt: userMemoriesIdentities.capturedAt,
          createdAt: userMemoriesIdentities.createdAt,
          description: userMemoriesIdentities.description,
          episodicDate: userMemoriesIdentities.episodicDate,
          id: userMemoriesIdentities.id,
          relationship: userMemoriesIdentities.relationship,
          role: userMemoriesIdentities.role,
          tags: userMemoriesIdentities.tags,
          title: userMemories.title,
          type: userMemoriesIdentities.type,
          updatedAt: userMemoriesIdentities.updatedAt,
        })
        .from(userMemoriesIdentities)
        .innerJoin(userMemories, joinCondition)
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemoriesIdentities)
        .innerJoin(userMemories, joinCondition)
        .where(whereClause),
    ]);

    return {
      items: rows,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total: Number(totalResult[0]?.count ?? 0),
    };
  };

  findById = async (id: string) => {
    return this.db.query.userMemoriesIdentities.findFirst({
      where: and(eq(userMemoriesIdentities.id, id), eq(userMemoriesIdentities.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<UserMemoryIdentity>) => {
    return this.db
      .update(userMemoriesIdentities)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(eq(userMemoriesIdentities.id, id), eq(userMemoriesIdentities.userId, this.userId)),
      );
  };

  /**
   * Query identities for chat context injection
   * Only returns user's own identities (relationship === 'self' or null/undefined)
   * Limited to most recent entries for performance
   */
  queryForInjection = async (limit = 50) => {
    return this.db
      .select({
        capturedAt: userMemoriesIdentities.capturedAt,
        createdAt: userMemoriesIdentities.createdAt,
        description: userMemoriesIdentities.description,
        id: userMemoriesIdentities.id,
        role: userMemoriesIdentities.role,
        type: userMemoriesIdentities.type,
        updatedAt: userMemoriesIdentities.updatedAt,
      })
      .from(userMemoriesIdentities)
      .where(
        and(
          eq(userMemoriesIdentities.userId, this.userId),
          // Only include self identities (relationship is 'self' or null/not set)
          or(
            eq(userMemoriesIdentities.relationship, RelationshipEnum.Self),
            isNull(userMemoriesIdentities.relationship),
          ),
        ),
      )
      .orderBy(desc(userMemoriesIdentities.capturedAt))
      .limit(limit);
  };
}
