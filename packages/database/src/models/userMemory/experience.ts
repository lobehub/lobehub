import type { ExperienceListParams, ExperienceListResult } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { NewUserMemoryExperience, UserMemoryExperience } from '../../schemas';
import { userMemories, userMemoriesExperiences } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class UserMemoryExperienceModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewUserMemoryExperience, 'userId'>) => {
    const [result] = await this.db
      .insert(userMemoriesExperiences)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const experience = await tx.query.userMemoriesExperiences.findFirst({
        where: and(
          eq(userMemoriesExperiences.id, id),
          eq(userMemoriesExperiences.userId, this.userId),
        ),
      });

      if (!experience || !experience.userMemoryId) {
        return { success: false };
      }

      // Delete the base user memory (cascade will handle the experience)
      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, experience.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return { success: true };
    });
  };

  deleteAll = async () => {
    return this.db
      .delete(userMemoriesExperiences)
      .where(eq(userMemoriesExperiences.userId, this.userId));
  };

  query = async (limit = 50) => {
    return this.db.query.userMemoriesExperiences.findMany({
      limit,
      orderBy: [desc(userMemoriesExperiences.createdAt)],
      where: eq(userMemoriesExperiences.userId, this.userId),
    });
  };

  /**
   * Query experience list with pagination, search, and sorting
   * Returns a flat structure optimized for frontend display
   */
  queryList = async (params: ExperienceListParams = {}): Promise<ExperienceListResult> => {
    const { order = 'desc', page = 1, pageSize = 20, q, sort, tags, types } = params;

    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const normalizedQuery = typeof q === 'string' ? q.trim() : '';

    // Build WHERE conditions
    const conditions: Array<SQL | undefined> = [
      eq(userMemoriesExperiences.userId, this.userId),
      // Full-text search across title, situation, keyLearning, action
      normalizedQuery
        ? or(
            ilike(userMemories.title, `%${normalizedQuery}%`),
            ilike(userMemoriesExperiences.situation, `%${normalizedQuery}%`),
            ilike(userMemoriesExperiences.keyLearning, `%${normalizedQuery}%`),
            ilike(userMemoriesExperiences.action, `%${normalizedQuery}%`),
          )
        : undefined,
      types && types.length > 0 ? inArray(userMemoriesExperiences.type, types) : undefined,
      tags && tags.length > 0
        ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesExperiences.tags})`))
        : undefined,
    ];

    const filters = conditions.filter((condition): condition is SQL => condition !== undefined);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Build ORDER BY
    const applyOrder = order === 'asc' ? asc : desc;
    const sortColumn =
      sort === 'scoreConfidence'
        ? userMemoriesExperiences.scoreConfidence
        : userMemoriesExperiences.capturedAt;

    const orderByClauses = [
      applyOrder(sortColumn),
      applyOrder(userMemoriesExperiences.updatedAt),
      applyOrder(userMemoriesExperiences.createdAt),
    ];

    // JOIN condition
    const joinCondition = and(
      eq(userMemories.id, userMemoriesExperiences.userMemoryId),
      eq(userMemories.userId, this.userId),
    );

    // Execute queries in parallel
    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          action: userMemoriesExperiences.action,
          capturedAt: userMemoriesExperiences.capturedAt,
          createdAt: userMemoriesExperiences.createdAt,
          id: userMemoriesExperiences.id,
          keyLearning: userMemoriesExperiences.keyLearning,
          scoreConfidence: userMemoriesExperiences.scoreConfidence,
          situation: userMemoriesExperiences.situation,
          tags: userMemoriesExperiences.tags,
          title: userMemories.title,
          type: userMemoriesExperiences.type,
          updatedAt: userMemoriesExperiences.updatedAt,
        })
        .from(userMemoriesExperiences)
        .innerJoin(userMemories, joinCondition)
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemoriesExperiences)
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
    return this.db.query.userMemoriesExperiences.findFirst({
      where: and(
        eq(userMemoriesExperiences.id, id),
        eq(userMemoriesExperiences.userId, this.userId),
      ),
    });
  };

  update = async (id: string, value: Partial<UserMemoryExperience>) => {
    return this.db
      .update(userMemoriesExperiences)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(eq(userMemoriesExperiences.id, id), eq(userMemoriesExperiences.userId, this.userId)),
      );
  };
}
