import type { NotificationMetadata } from '@lobechat/types';
import { NotificationSettingsSchema } from '@lobechat/types';
import { z } from 'zod';

import type { NotificationItem } from '@/database/schemas';
import type { NotificationNavigationCount } from '@/server/services/notification/inboxCounts';

import { dateTimeSchema } from './common.type';

export const NotificationIdParamSchema = z.object({
  id: z.string().min(1),
});
export type NotificationIdParam = z.infer<typeof NotificationIdParamSchema>;

/** Query strings carry booleans as text; coerce them back before hitting the model. */
const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();

export const NotificationListQuerySchema = z.object({
  category: z.string().optional(),
  /** Opaque cursor: the `id` of the last row from the previous page. */
  cursor: z.string().optional(),
  isRead: booleanQuery,
  limit: z.coerce.number().int().min(1).max(50).optional(),
  unreadOnly: booleanQuery,
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const MarkNotificationsReadRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequestSchema>;

/**
 * Which notification settings a call reads or patches. `personal` is the
 * account-wide bag (channel switches, IM platforms, body detail); `workspace`
 * is the caller's per-member gate for the request's workspace and needs an
 * `X-Workspace-Id`.
 */
export const NotificationSettingsQuerySchema = z.object({
  scope: z.enum(['personal', 'workspace']).default('personal'),
});
export type NotificationSettingsQuery = z.infer<typeof NotificationSettingsQuerySchema>;
export type NotificationSettingsScope = NotificationSettingsQuery['scope'];

export const UpdateNotificationSettingsRequestSchema = NotificationSettingsSchema;
export type UpdateNotificationSettingsRequest = z.infer<
  typeof UpdateNotificationSettingsRequestSchema
>;

// ==================== Response Schemas ====================

const NotificationMetadataSchema = z
  .object({
    /** The person who triggered a user-driven notification, snapshotted at send time. */
    actor: z
      .object({
        avatar: z.string().optional(),
        name: z.string().optional(),
        userId: z.string().optional(),
      })
      .strict()
      .optional(),
    /** The agent behind an agent-driven notification, snapshotted at send time. */
    agent: z
      .object({
        avatar: z.string().optional(),
        backgroundColor: z.string().optional(),
        id: z.string(),
        name: z.string().optional(),
      })
      .strict()
      .optional(),
    /** The resource-transfer request this notification is about. */
    transfer: z.object({ requestId: z.string() }).strict().optional(),
  } satisfies Record<keyof NotificationMetadata, z.ZodType>)
  .strict();

/** An inbox row as the model reads it. */
export const NotificationSchema = z
  .object({
    actionUrl: z.string().nullable(),
    category: z.string(),
    content: z.string(),
    context: z.string().nullable(),
    createdAt: dateTimeSchema,
    dedupeKey: z.string().nullable(),
    id: z.string(),
    isArchived: z.boolean(),
    isRead: z.boolean(),
    metadata: NotificationMetadataSchema.nullable(),
    title: z.string(),
    type: z.string(),
    updatedAt: dateTimeSchema,
    userId: z.string(),
    workspaceId: z.string().nullable(),
  } satisfies Record<keyof NotificationItem, z.ZodType>)
  .strict()
  .meta({ id: 'Notification' });

export const NotificationUnreadCountSchema = z
  .object({ count: z.number().int() })
  .strict()
  .meta({ id: 'NotificationUnreadCount' });

/** Read / unread / total tallies of one category, live transfer requests included. */
export const NotificationCategoryCountSchema = z
  .object({
    category: z.string(),
    readCount: z.number().int(),
    totalCount: z.number().int(),
    unreadCount: z.number().int(),
  } satisfies Record<keyof NotificationNavigationCount, z.ZodType>)
  .strict()
  .meta({ id: 'NotificationCategoryCount' });

/** The stored settings of the requested scope; switches never set are absent. */
export const NotificationSettingsResponseSchema = NotificationSettingsSchema.meta({
  id: 'NotificationSettings',
});

/**
 * The whole body of a transition that has nothing to report back (mark read,
 * archive): the success envelope without `data`.
 */
export const NotificationAcknowledgementSchema = z
  .object({
    message: z.string(),
    success: z.literal(true),
    timestamp: dateTimeSchema,
  })
  .strict();
