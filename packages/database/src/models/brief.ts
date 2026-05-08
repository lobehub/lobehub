import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import type { BriefItem, NewBrief } from '../schemas/task';
import { briefs, tasks } from '../schemas/task';
import type { LobeChatDatabase } from '../type';

export interface UnresolvedBriefRow {
  agentAvatar: string | null;
  agentBackgroundColor: string | null;
  agentRowId: string | null;
  agentTitle: string | null;
  brief: BriefItem;
  taskStatus: string | null;
}

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

  // For Daily Brief homepage — unresolved briefs sorted by priority.
  // Capped via `limit` (default 20) so heavy-inbox users don't pay the full
  // enrich cost on every home render; users beyond the cap reach the rest
  // through the task list page.
  async listUnresolved(options?: { limit?: number }): Promise<BriefItem[]> {
    const { limit = 20 } = options ?? {};
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
      )
      .limit(limit);
  }

  /**
   * Same shape as {@link listUnresolved} but joins the producing agent and
   * the parent task in a single SQL — saves one round trip vs. fetching
   * briefs first and then enriching client-side. Used by the home Daily
   * Brief surface where every brief renders `agent` + `taskStatus`.
   */
  async listUnresolvedEnriched(options?: { limit?: number }): Promise<UnresolvedBriefRow[]> {
    const { limit = 20 } = options ?? {};
    return this.db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentRowId: agents.id,
        agentTitle: agents.title,
        brief: briefs,
        taskStatus: tasks.status,
      })
      .from(briefs)
      .leftJoin(agents, eq(briefs.agentId, agents.id))
      .leftJoin(tasks, eq(briefs.taskId, tasks.id))
      .where(and(eq(briefs.userId, this.userId), isNull(briefs.resolvedAt)))
      .orderBy(
        sql`CASE
          WHEN ${briefs.priority} = 'urgent' THEN 0
          WHEN ${briefs.priority} = 'normal' THEN 1
          ELSE 2
        END`,
        desc(briefs.createdAt),
      )
      .limit(limit);
  }

  async findByTaskId(taskId: string): Promise<BriefItem[]> {
    return this.db
      .select()
      .from(briefs)
      .where(and(eq(briefs.taskId, taskId), eq(briefs.userId, this.userId)))
      .orderBy(desc(briefs.createdAt));
  }

  // Used by heartbeat re-arm to skip rescheduling when a task is already
  // waiting on user action (review max-iter etc). Optionally exclude brief
  // types — heartbeat callers exclude `error` because transient errors are
  // governed by the fuse counter, not by the existence of the error brief
  // itself (otherwise the very first error would block all retries).
  async hasUnresolvedUrgentByTask(
    taskId: string,
    options?: { excludeTypes?: string[] },
  ): Promise<boolean> {
    const excludeTypes = options?.excludeTypes ?? [];
    const conditions = [
      eq(briefs.userId, this.userId),
      eq(briefs.taskId, taskId),
      eq(briefs.priority, 'urgent'),
      isNull(briefs.resolvedAt),
    ];
    if (excludeTypes.length > 0) {
      conditions.push(notInArray(briefs.type, excludeTypes));
    }

    const rows = await this.db
      .select({ id: briefs.id })
      .from(briefs)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
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
