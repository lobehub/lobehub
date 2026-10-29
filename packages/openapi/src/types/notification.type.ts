import { NotificationSettingsSchema } from '@lobechat/types';
import { z } from 'zod';

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
