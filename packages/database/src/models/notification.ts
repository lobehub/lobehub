import { and, count, desc, eq, inArray, lt, or } from 'drizzle-orm';

import type { NewNotification, NewNotificationDelivery } from '../schemas/notification';
import { notificationDeliveries, notifications } from '../schemas/notification';
import type { LobeChatDatabase } from '../type';

export class NotificationModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async list(
    opts: { category?: string; cursor?: string; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const { cursor, limit = 20, category, unreadOnly } = opts;

    const conditions = [eq(notifications.userId, this.userId), eq(notifications.isArchived, false)];

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    if (category) {
      conditions.push(eq(notifications.category, category));
    }

    if (cursor) {
      const cursorRow = await this.db
        .select({ createdAt: notifications.createdAt, id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, cursor), eq(notifications.userId, this.userId)))
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

  async getUnreadCount(): Promise<number> {
    const [result] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, this.userId),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false),
        ),
      );

    return result?.count ?? 0;
  }

  async markAsRead(ids: string[]) {
    if (ids.length === 0) return;

    return this.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(notifications.userId, this.userId), inArray(notifications.id, ids)));
  }

  async markAllAsRead() {
    return this.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(
          eq(notifications.userId, this.userId),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false),
        ),
      );
  }

  async archive(id: string) {
    return this.db
      .update(notifications)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, this.userId)));
  }

  async archiveAll() {
    return this.db
      .update(notifications)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(eq(notifications.userId, this.userId), eq(notifications.isArchived, false)));
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
