import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { NotificationController } from '../controllers/notification.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  MarkNotificationsReadRequestSchema,
  NotificationIdParamSchema,
  NotificationListQuerySchema,
} from '../types/notification.type';

/**
 * Notification routes — the delivery side of proactive agent work.
 *
 * Reads are auth-only: the inbox is already scoped to the caller by user (and
 * workspace) inside the model, so there is nothing narrower to check. Writes
 * mirror the in-app `message:create` gate.
 */
const NotificationRoutes = new Hono();

const notificationWrite = requireAnyPermission(
  getAllScopePermissions('MESSAGE_CREATE'),
  'You do not have permission to manage notifications',
);

/** GET /api/v1/notifications */
NotificationRoutes.get(
  '/',
  requireAuth,
  zValidator('query', NotificationListQuerySchema),
  async (c) => new NotificationController().listNotifications(c),
);

/** GET /api/v1/notifications/unread-count */
NotificationRoutes.get(
  '/unread-count',
  describeRoute({
    operationId: 'getUnreadNotificationCount',
    summary: 'Get the unread notification count',
    tags: ['notifications'],
  }),
  requireAuth,
  async (c) => new NotificationController().getUnreadCount(c),
);

/** GET /api/v1/notifications/counts — per-category read/unread/total tallies. */
NotificationRoutes.get(
  '/counts',
  describeRoute({
    operationId: 'getNotificationCounts',
    summary: 'Get per-category notification counts',
    tags: ['notifications'],
  }),
  requireAuth,
  async (c) => new NotificationController().getNavigationCounts(c),
);

/** POST /api/v1/notifications/read */
NotificationRoutes.post(
  '/read',
  describeRoute({ operationId: 'markNotificationsRead', tags: ['notifications'] }),
  requireAuth,
  notificationWrite,
  zValidator('json', MarkNotificationsReadRequestSchema),
  async (c) => new NotificationController().markAsRead(c),
);

/** POST /api/v1/notifications/read-all */
NotificationRoutes.post(
  '/read-all',
  describeRoute({
    operationId: 'markAllNotificationsRead',
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
  describeRoute({
    operationId: 'archiveAllNotifications',
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
  describeRoute({ operationId: 'archiveNotification', tags: ['notifications'] }),
  requireAuth,
  notificationWrite,
  zValidator('param', NotificationIdParamSchema),
  async (c) => new NotificationController().archive(c),
);

export default NotificationRoutes;
