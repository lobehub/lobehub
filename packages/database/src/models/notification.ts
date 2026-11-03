import { and, count, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';

import type { NewNotification, NewNotificationDelivery } from '../schemas/notification';
import { notificationDeliveries, notifications } from '../schemas/notification';
import type { LobeChatDatabase } from '../type';

export interface NotificationModelOptions {
  /**
   * Inbox context scope. `null` = personal mode (only rows with
   * `workspace_id IS NULL`); a workspace id = only that workspace's rows.
   * Omit for context-free access (write side / ops tooling), where read
   * queries span both personal and workspace notifications.
   */
  workspaceId?: string | null;
}

export class NotificationModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, options?: NotificationModelOptions) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = options?.workspaceId;
  }

  private ownership = () => eq(notifications.userId, this.userId);

  /** Context conditions: ownership plus the workspace/personal scope when set */
  private scope = (): SQL[] => {
    const conditions: SQL[] = [this.ownership()];
    if (this.workspaceId === null) conditions.push(isNull(notifications.workspaceId));
    else if (this.workspaceId) conditions.push(eq(notifications.workspaceId, this.workspaceId));
    return conditions;
  };

  async list(
    opts: {
      category?: string;
      cursor?: string;
      isRead?: boolean;
      limit?: number;
      unreadOnly?: boolean;
    } = {},
  ) {
    const { cursor, limit = 20, category, isRead, unreadOnly } = opts;

    const conditions = [...this.scope(), eq(notifications.isArchived, false)];

    if (typeof isRead === 'boolean') {
      conditions.push(eq(notifications.isRead, isRead));
    } else if (unreadOnly) {
      // Keep old desktop clients working while the notification center moves
      // to the explicit read / unread tabs.
      conditions.push(eq(notifications.isRead, false));
    }

    if (category) {
      conditions.push(eq(notifications.category, category));
    }

    if (cursor) {
      const cursorRow = await this.db
        .select({ createdAt: notifications.createdAt, id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, cursor), ...this.scope()))
        .limit(1);

      if (cursorRow[0]) {
        // Composite cursor to handle identical createdAt timestamps
        const { createdAt: cursorTime, id: cursorId } = cursorRow[0];
        conditions.push(
          or(
            lt(notifications.createdAt, cursorTime),
            and(eq(notifications.createdAt, cursorTime), lt(notifications.id, cursorId)),
          )!,
        );
      }
    }

    return this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit);
  }

  async getNavigationCounts() {
    const rows = await this.db
      .select({
        category: notifications.category,
        count: count(),
        isRead: notifications.isRead,
      })
      .from(notifications)
      .where(and(...this.scope(), eq(notifications.isArchived, false)))
      .groupBy(notifications.category, notifications.isRead);

    const counts = new Map<
      string,
      { category: string; readCount: number; totalCount: number; unreadCount: number }
    >();
    for (const row of rows) {
      const categoryCounts = counts.get(row.category) ?? {
        category: row.category,
        readCount: 0,
        totalCount: 0,
        unreadCount: 0,
      };

      categoryCounts.totalCount += row.count;
      if (row.isRead) categoryCounts.readCount += row.count;
      else categoryCounts.unreadCount += row.count;
      counts.set(row.category, categoryCounts);
    }

    return [...counts.values()];
  }

  /**
   * Unarchived `pending`-category rows linked (via
   * `metadata.transfer.requestId`) to the given live transfer requests, split
   * into total and unread. Navigation counts use this to swap row-based
   * counting for request-based counting on the pending category: a linked
   * row's read state must not hide a still-unresolved request, and a live
   * request whose linked row is missing/archived must still count toward the
   * totals its rendered card contributes to. Scoped to the pending category
   * because only rows counted there may be swapped out — a linked row that
   * landed in another category counts toward that category, not against the
   * requests.
   */
  async countLinkedToTransfers(requestIds: string[]): Promise<{ total: number; unread: number }> {
    if (requestIds.length === 0) return { total: 0, unread: 0 };

    const [result] = await this.db
      .select({
        total: count(),
        // count() skips NULLs, so the CASE narrows the aggregate to unread rows.
        unread: count(sql`case when ${notifications.isRead} = false then 1 end`),
      })
      .from(notifications)
      .where(
        and(
          ...this.scope(),
          eq(notifications.category, 'pending'),
          eq(notifications.isArchived, false),
          inArray(sql`${notifications.metadata} -> 'transfer' ->> 'requestId'`, requestIds),
        ),
      );

    return { total: result?.total ?? 0, unread: result?.unread ?? 0 };
  }

  async getUnreadCount(): Promise<number> {
    const [result] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(...this.scope(), eq(notifications.isRead, false), eq(notifications.isArchived, false)),
      );

    return result?.count ?? 0;
  }

  async markAsRead(ids: string[]) {
    if (ids.length === 0) return;

    return this.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(...this.scope(), inArray(notifications.id, ids)));
  }

  async markAllAsRead() {
    return this.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(...this.scope(), eq(notifications.isRead, false), eq(notifications.isArchived, false)),
      );
  }

  async archive(id: string) {
    return this.db
      .update(notifications)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(eq(notifications.id, id), ...this.scope()));
  }

  async archiveAll() {
    return this.db
      .update(notifications)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(...this.scope(), eq(notifications.isArchived, false)));
  }

  // ─── Write-side (used by NotificationService in cloud) ─────────

  async create(data: Omit<NewNotification, 'userId'>) {
    const [result] = await this.db
      .insert(notifications)
      .values({ ...data, userId: this.userId })
      .onConflictDoNothing({
        target: [notifications.userId, notifications.dedupeKey],
      })
      .returning();

    return result ?? null;
  }

  async createDelivery(data: NewNotificationDelivery) {
    const [result] = await this.db.insert(notificationDeliveries).values(data).returning();

    return result;
  }
}
