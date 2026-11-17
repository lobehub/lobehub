import {
  DASHBOARD_DESCRIPTION_MAX_LENGTH,
  DASHBOARD_TITLE_MAX_LENGTH,
} from '@lobechat/builtin-tool-dashboard';
import { DASHBOARD_VISIBILITIES } from '@lobechat/types';
import { z } from 'zod';

import { DASHBOARD_MAX_ITEMS } from '@/database/models/dashboard';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';
import { DashboardItemLayoutSchema, WidgetSchema, WidgetVersionSchema } from './widget.type';

/**
 * Dashboards on the public REST API: a board lays widgets out on a grid. Rules
 * are the `dashboard` tRPC router's, called server-side.
 */

const uuid = z.uuid();

export const DashboardIdParamSchema = z.object({ id: uuid.describe('Dashboard id.') });

export const DashboardItemParamSchema = DashboardIdParamSchema.extend({
  itemId: uuid.describe('Item id — the placement, not the widget.'),
});

const visibility = z
  .enum(DASHBOARD_VISIBILITIES)
  .describe('`public` boards are visible to the whole workspace; `private` ones to the creator.');

// ==================== Responses ====================

export const DashboardSchema = z
  .object({
    agentId: z.string().nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    icon: z.string().nullable(),
    id: z.string(),
    metadata: jsonObjectSchema.nullable(),
    projectId: z.string().nullable(),
    sortOrder: z.number().int(),
    title: z.string(),
    updatedAt: dateTimeSchema,
    userId: z.string().describe('The creator.'),
    visibility,
    workspaceId: z.string().nullable(),
  })
  .meta({ id: 'Dashboard' });

export type DashboardResponse = z.infer<typeof DashboardSchema>;

export const DashboardListResponseSchema = paginatedListSchema(DashboardSchema, { total: true });

export const DashboardItemSchema = z
  .object({
    createdAt: dateTimeSchema,
    dashboardId: z.string(),
    id: z.string(),
    layout: DashboardItemLayoutSchema.nullable(),
    sortOrder: z.number().int(),
    updatedAt: dateTimeSchema,
    widgetId: z.string(),
  })
  .meta({ id: 'DashboardItem' });

export type DashboardItemResponse = z.infer<typeof DashboardItemSchema>;

export const DashboardDetailSchema = DashboardSchema.extend({
  items: z
    .array(
      DashboardItemSchema.extend({
        view: WidgetVersionSchema.shape.view.describe("The published version's view."),
        widget: WidgetSchema,
      }),
    )
    .describe('The widgets on the board the caller may read, in display order.'),
}).meta({ id: 'DashboardDetail' });

export type DashboardDetailResponse = z.infer<typeof DashboardDetailSchema>;

export const DashboardLayoutResultSchema = z
  .object({ updated: z.number().int().min(0).describe('How many items moved.') })
  .meta({ id: 'DashboardLayoutResult' });

// ==================== Requests ====================

export const DashboardListQuerySchema = CursorPaginationQuerySchema.extend({
  agentId: z.string().min(1).optional().describe('Boards living on this agent.'),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe('Boards living on this project (not its agents).'),
});

export type DashboardListQuery = z.infer<typeof DashboardListQuerySchema>;

const boardFields = {
  description: z.string().max(DASHBOARD_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  metadata: jsonObjectSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
  visibility: visibility.optional(),
};

export const CreateDashboardRequestSchema = z.object({
  ...boardFields,
  agentId: z.string().min(1).optional().describe('Put the board on this agent.'),
  projectId: z.string().min(1).optional().describe('Put the board on this project.'),
  title: z.string().min(1).max(DASHBOARD_TITLE_MAX_LENGTH),
  widgetId: uuid.optional().describe('Place this widget on the new board in the same transaction.'),
});

export type CreateDashboardRequest = z.infer<typeof CreateDashboardRequestSchema>;

export const UpdateDashboardRequestSchema = z
  .object({ ...boardFields, title: z.string().min(1).max(DASHBOARD_TITLE_MAX_LENGTH).optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export type UpdateDashboardRequest = z.infer<typeof UpdateDashboardRequestSchema>;

export const AddDashboardItemRequestSchema = z.object({
  layout: DashboardItemLayoutSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
  widgetId: uuid.describe('A widget the caller can read.'),
});

export type AddDashboardItemRequest = z.infer<typeof AddDashboardItemRequestSchema>;

export const UpdateDashboardLayoutRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuid.describe('Item id.'),
        layout: DashboardItemLayoutSchema.nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(DASHBOARD_MAX_ITEMS),
});

export type UpdateDashboardLayoutRequest = z.infer<typeof UpdateDashboardLayoutRequestSchema>;
