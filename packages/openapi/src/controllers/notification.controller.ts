import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { NotificationRestService } from '../services/notification.service';
import type {
  MarkNotificationsReadRequest,
  NotificationIdParam,
  NotificationListQuery,
} from '../types/notification.type';

/** Notifications controller — inbox reads and read/archive transitions. */
export class NotificationController extends BaseController {
  private async service(c: Context): Promise<NotificationRestService> {
    return new NotificationRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/notifications */
  async listNotifications(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<NotificationListQuery>(c);
      const service = await this.service(c);
      return this.success(
        c,
        await service.listNotifications(query),
        'Notification list retrieved successfully',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/notifications/unread-count */
  async getUnreadCount(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, { count: await service.getUnreadCount() });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/notifications/counts */
  async getNavigationCounts(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, await service.getNavigationCounts());
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/notifications/read */
  async markAsRead(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<MarkNotificationsReadRequest>(c);
      const service = await this.service(c);
      await service.markAsRead(body.ids);
      return this.success(c, undefined, 'Notifications marked as read');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/notifications/read-all */
  async markAllAsRead(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      await service.markAllAsRead();
      return this.success(c, undefined, 'All notifications marked as read');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/notifications/archive-all */
  async archiveAll(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      await service.archiveAll();
      return this.success(c, undefined, 'All notifications archived');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/notifications/:id/archive */
  async archive(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<NotificationIdParam>(c);
      const service = await this.service(c);
      await service.archive(id);
      return this.success(c, undefined, 'Notification archived');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
