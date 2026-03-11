import type { ActivityListParams, ActivityListResult } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { NewUserMemoryActivity, UserMemoryActivity } from '../../schemas';
import { userMemories, userMemoriesActivities } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class UserMemoryActivityModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewUserMemoryActivity, 'userId'>) => {
    const [result] = await this.db
      .insert(userMemoriesActivities)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const activity = await tx.query.userMemoriesActivities.findFirst({
        where: and(
          eq(userMemoriesActivities.id, id),
          eq(userMemoriesActivities.userId, this.userId),
        ),
      });

      if (!activity || !activity.userMemoryId) {
        return { success: false };
      }

      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, activity.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return { success: true };
    });
  };

  deleteAll = async () => {
    return this.db
      .delete(userMemoriesActivities)
      .where(eq(userMemoriesActivities.userId, this.userId));
  };

  query = async (limit = 50) => {
    return this.db.query.userMemoriesActivities.findMany({
      limit,
      orderBy: [desc(userMemoriesActivities.createdAt)],
      where: eq(userMemoriesActivities.userId, this.userId),
    });
  };

  queryList = async (params: ActivityListParams = {}): Promise<ActivityListResult> => {
    const { order = 'desc', page = 1, pageSize = 20, q, sort, status, tags, types } = params;

    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const normalizedQuery = typeof q === 'string' ? q.trim() : '';

    const conditions: Array<SQL | undefined> = [
      eq(userMemoriesActivities.userId, this.userId),
      normalizedQuery
        ? or(
            ilike(userMemories.title, `%${normalizedQuery}%`),
            ilike(userMemoriesActivities.narrative, `%${normalizedQuery}%`),
            ilike(userMemoriesActivities.notes, `%${normalizedQuery}%`),
            ilike(userMemoriesActivities.feedback, `%${normalizedQuery}%`),
          )
        : undefined,
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

    const filters = conditions.filter((condition): condition is SQL => condition !== undefined);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const applyOrder = order === 'asc' ? asc : desc;
    const sortColumn =
      sort === 'startsAt' ? userMemoriesActivities.startsAt : userMemoriesActivities.capturedAt;

    const orderByClauses = [
      applyOrder(sortColumn),
      applyOrder(userMemoriesActivities.updatedAt),
      applyOrder(userMemoriesActivities.createdAt),
    ];

    const joinCondition = and(
      eq(userMemories.id, userMemoriesActivities.userMemoryId),
      eq(userMemories.userId, this.userId),
    );

    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          capturedAt: userMemoriesActivities.capturedAt,
          createdAt: userMemoriesActivities.createdAt,
          endsAt: userMemoriesActivities.endsAt,
          id: userMemoriesActivities.id,
          narrative: userMemoriesActivities.narrative,
          notes: userMemoriesActivities.notes,
          startsAt: userMemoriesActivities.startsAt,
          status: userMemoriesActivities.status,
          tags: userMemoriesActivities.tags,
          timezone: userMemoriesActivities.timezone,
          title: userMemories.title,
          type: userMemoriesActivities.type,
          updatedAt: userMemoriesActivities.updatedAt,
        })
        .from(userMemoriesActivities)
        .innerJoin(userMemories, joinCondition)
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userMemoriesActivities)
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
    return this.db.query.userMemoriesActivities.findFirst({
      where: and(eq(userMemoriesActivities.id, id), eq(userMemoriesActivities.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<UserMemoryActivity>) => {
    return this.db
      .update(userMemoriesActivities)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(eq(userMemoriesActivities.id, id), eq(userMemoriesActivities.userId, this.userId)),
      );
  };
}
