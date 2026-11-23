import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { NotificationController } from '../controllers/notification.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import {
  MarkNotificationsReadRequestSchema,
  NotificationAcknowledgementSchema,
  NotificationCategoryCountSchema,
  NotificationIdParamSchema,
  NotificationListQuerySchema,
  NotificationSchema,
  NotificationSettingsQuerySchema,
  NotificationSettingsResponseSchema,
  NotificationUnreadCountSchema,
  UpdateNotificationSettingsRequestSchema,
} from '../types/notification.type';

/**
 * Notification routes — the delivery side of proactive agent work.
 *
 * Reads are auth-only: the inbox is already scoped to the caller by user (and
 * workspace) inside the model, so there is nothing narrower to check. Writes
 * mirror the in-app `message:create` gate.
 *
 * Settings are the caller's own preferences, so they need no RBAC grant; a
 * restricted API key still needs the scope of the store it touches — `user:*`
 * for personal settings, `workspace:*` for the per-member workspace gate,
 * matching the tRPC `user` and `workspaceUserSettings` namespaces.
 */
const NotificationRoutes = new Hono();

const notificationWrite = requireAnyPermission(
  getAllScopePermissions('MESSAGE_CREATE'),
  'You do not have permission to manage notifications',
);

/** GET /api/v1/notifications */
NotificationRoutes.get(
  '/',
  routeDoc({
    data: z.array(NotificationSchema),
    description:
      'Unarchived notifications, newest first; pass the last `id` as `cursor` for the next page.',
    summary: 'List notifications',
    tags: ['notifications'],
  }),
  requireAuth,
  zValidator('query', NotificationListQuerySchema),
  async (c) => new NotificationController().listNotifications(c),
);

const settingsApiKeyScope =
  (access: 'read' | 'write'): MiddlewareHandler =>
  (c, next) => {
    const store = c.req.query('scope') === 'workspace' ? 'workspace' : 'user';
    return requireApiKeyScope(`${store}:${access}`)(c, next);
  };

/** GET /api/v1/notifications/settings */
NotificationRoutes.get(
  '/settings',
  routeDoc({
    data: NotificationSettingsResponseSchema,
    summary: 'Get notification delivery settings',
    tags: ['notifications'],
  }),
  requireAuth,
  settingsApiKeyScope('read'),
  zValidator('query', NotificationSettingsQuerySchema),
  async (c) => new NotificationController().getSettings(c),
);

/** PATCH /api/v1/notifications/settings — merges the patch; untouched switches keep their value. */
NotificationRoutes.patch(
  '/settings',
  routeDoc({
    data: NotificationSettingsResponseSchema,
    description: 'Answers with the merged settings now stored for the scope.',
    summary: 'Update notification delivery settings',
    tags: ['notifications'],
  }),
  requireAuth,
  settingsApiKeyScope('write'),
  zValidator('query', NotificationSettingsQuerySchema),
  zValidator('json', UpdateNotificationSettingsRequestSchema),
  async (c) => new NotificationController().updateSettings(c),
);

/** GET /api/v1/notifications/unread-count */
NotificationRoutes.get(
  '/unread-count',
  routeDoc({
    data: NotificationUnreadCountSchema,
    summary: 'Get the unread notification count',
    tags: ['notifications'],
  }),
  requireAuth,
  async (c) => new NotificationController().getUnreadCount(c),
);

/** GET /api/v1/notifications/counts — per-category read/unread/total tallies. */
NotificationRoutes.get(
  '/counts',
  routeDoc({
    data: z.array(NotificationCategoryCountSchema),
    operationId: 'notifications.getCounts',
    summary: 'Get per-category notification counts',
    tags: ['notifications'],
  }),
  requireAuth,
  async (c) => new NotificationController().getNavigationCounts(c),
);

/** POST /api/v1/notifications/read */
NotificationRoutes.post(
  '/read',
  routeDoc({
    data: NotificationAcknowledgementSchema,
    // Nothing to report back: the body is the success envelope without `data`.
    envelope: false,
    operationId: 'notifications.markRead',
    summary: 'Mark notifications as read',
    tags: ['notifications'],
  }),
  requireAuth,
  notificationWrite,
  zValidator('json', MarkNotificationsReadRequestSchema),
  async (c) => new NotificationController().markAsRead(c),
);

/** POST /api/v1/notifications/read-all */
NotificationRoutes.post(
  '/read-all',
  routeDoc({
    data: NotificationAcknowledgementSchema,
    // Nothing to report back: the body is the success envelope without `data`.
    envelope: false,
    operationId: 'notifications.markAllRead',
    summary: 'Mark every notification as read',
    tags: ['notifications'],
  }),
  requireAuth,
  notificationWrite,
  async (c) => new NotificationController().markAllAsRead(c),
);

/** POST /api/v1/notifications/archive-all */
NotificationRoutes.post(
  '/archive-all',
  routeDoc({
    data: NotificationAcknowledgementSchema,
    // Nothing to report back: the body is the success envelope without `data`.
    envelope: false,
    operationId: 'notifications.archiveAll',
    summary: 'Archive every notification',
    tags: ['notifications'],
  }),
  requireAuth,
  notificationWrite,
  async (c) => new NotificationController().archiveAll(c),
);

/** POST /api/v1/notifications/:id/archive */
NotificationRoutes.post(
  '/:id/archive',
  routeDoc({
    data: NotificationAcknowledgementSchema,
    // Nothing to report back: the body is the success envelope without `data`.
    envelope: false,
    operationId: 'notifications.archive',
    summary: 'Archive a notification',
    tags: ['notifications'],
  }),
  requireAuth,
  notificationWrite,
  zValidator('param', NotificationIdParamSchema),
  async (c) => new NotificationController().archive(c),
);

export default NotificationRoutes;
