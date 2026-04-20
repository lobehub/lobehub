import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { BriefItem, NewBrief } from '../schemas/task';
import { briefs } from '../schemas/task';
import type { LobeChatDatabase } from '../type';

export class BriefModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async create(data: Omit<NewBrief, 'id' | 'userId'>): Promise<BriefItem> {
    const result = await this.db
      .insert(briefs)
      .values({ ...data, userId: this.userId })
      .returning();

    return result[0];
  }

  async findById(id: string): Promise<BriefItem | null> {
    const result = await this.db
      .select()
      .from(briefs)
      .where(and(eq(briefs.id, id), eq(briefs.userId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    type?: string;
  }): Promise<{ briefs: BriefItem[]; total: number }> {
    const { type, limit = 50, offset = 0 } = options || {};

    const conditions = [eq(briefs.userId, this.userId)];
    if (type) conditions.push(eq(briefs.type, type));

    const where = and(...conditions);

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(briefs)
      .where(where);

    const items = await this.db
      .select()
      .from(briefs)
      .where(where)
      .orderBy(desc(briefs.createdAt))
      .limit(limit)
      .offset(offset);

    return { briefs: items, total: Number(countResult[0].count) };
  }

  // For Daily Brief homepage — unresolved briefs sorted by priority
  async listUnresolved(): Promise<BriefItem[]> {
    return this.db
      .select()
      .from(briefs)
      .where(and(eq(briefs.userId, this.userId), isNull(briefs.resolvedAt)))
      .orderBy(
        sql`CASE
          WHEN ${briefs.priority} = 'urgent' THEN 0
          WHEN ${briefs.priority} = 'normal' THEN 1
          ELSE 2
        END`,
        desc(briefs.createdAt),
      );
  }

  async findByTaskId(taskId: string): Promise<BriefItem[]> {
    return this.db
      .select()
      .from(briefs)
      .where(and(eq(briefs.taskId, taskId), eq(briefs.userId, this.userId)))
      .orderBy(desc(briefs.createdAt));
  }

  async findByCronJobId(cronJobId: string): Promise<BriefItem[]> {
    return this.db
      .select()
      .from(briefs)
      .where(and(eq(briefs.cronJobId, cronJobId), eq(briefs.userId, this.userId)))
      .orderBy(desc(briefs.createdAt));
  }

  async markRead(id: string): Promise<BriefItem | null> {
    const result = await this.db
      .update(briefs)
      .set({ readAt: new Date() })
      .where(and(eq(briefs.id, id), eq(briefs.userId, this.userId)))
      .returning();

    return result[0] || null;
  }

  async resolve(
    id: string,
    options?: { action?: string; comment?: string },
  ): Promise<BriefItem | null> {
    const result = await this.db
      .update(briefs)
      .set({
        readAt: new Date(),
        resolvedAction: options?.action,
        resolvedAt: new Date(),
        resolvedComment: options?.comment,
      })
      .where(and(eq(briefs.id, id), eq(briefs.userId, this.userId)))
      .returning();

    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(briefs)
      .where(and(eq(briefs.id, id), eq(briefs.userId, this.userId)))
      .returning();

    return result.length > 0;
  }
}
