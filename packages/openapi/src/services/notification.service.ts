import { NotificationModel } from '@/database/models/notification';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type { NotificationListQuery } from '../types/notification.type';

/**
 * Notifications REST service.
 *
 * The inbox is scoped exactly like the in-app one: personal scope sees only
 * rows with `workspace_id IS NULL`, a workspace scope sees only its own rows,
 * so the two contexts never leak into each other.
 */
export class NotificationRestService extends BaseService {
  private readonly notificationModel: NotificationModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.notificationModel = new NotificationModel(db, userId ?? '', {
      workspaceId: workspaceId ?? null,
    });
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
    return this.notificationModel.getUnreadCount();
  }

  async getNavigationCounts(): ServiceResult<unknown> {
    return this.notificationModel.getNavigationCounts();
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
