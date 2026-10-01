import { NotificationModel } from '@/database/models/notification';
import type { LobeChatDatabase } from '@/database/type';
import {
  type InboxCountContext,
  type NotificationNavigationCount,
  resolveNavigationCounts,
  resolveUnreadCount,
} from '@/server/services/notification/inboxCounts';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type { NotificationListQuery } from '../types/notification.type';

/**
 * Notifications REST service.
 *
 * The inbox is scoped exactly like the in-app one: personal scope sees only
 * rows with `workspace_id IS NULL`, a workspace scope sees only its own rows,
 * so the two contexts never leak into each other. The unread and per-category
 * counts go through the same live-transfer reconciliation the tRPC router uses,
 * so a pending transfer request keeps prompting here too instead of the two
 * surfaces disagreeing.
 */
export class NotificationRestService extends BaseService {
  private readonly notificationModel: NotificationModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.notificationModel = new NotificationModel(db, userId ?? '', {
      workspaceId: workspaceId ?? null,
    });
  }

  private inboxCountContext(): InboxCountContext {
    return {
      notificationModel: this.notificationModel,
      serverDB: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };
  }

  async listNotifications(query: NotificationListQuery): ServiceResult<unknown> {
    return this.notificationModel.list({
      category: query.category,
      cursor: query.cursor,
      isRead: query.isRead,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
    });
  }

  async getUnreadCount(): ServiceResult<number> {
    return resolveUnreadCount(this.inboxCountContext());
  }

  async getNavigationCounts(): ServiceResult<NotificationNavigationCount[]> {
    return resolveNavigationCounts(this.inboxCountContext());
  }

  async markAsRead(ids: string[]): ServiceResult<unknown> {
    return this.notificationModel.markAsRead(ids);
  }

  async markAllAsRead(): ServiceResult<unknown> {
    return this.notificationModel.markAllAsRead();
  }

  async archive(id: string): ServiceResult<unknown> {
    return this.notificationModel.archive(id);
  }

  async archiveAll(): ServiceResult<unknown> {
    return this.notificationModel.archiveAll();
  }
}
