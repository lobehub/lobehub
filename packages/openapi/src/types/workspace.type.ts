import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';
import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

/**
 * Team workspaces, their members, invitations and audit log.
 *
 * Every rule (who may invite, which roles an admin may grant, the primary
 * owner's protection, the Business-plan gate on the audit log) lives in the
 * cloud `workspace*` tRPC routers these endpoints call; the open-source build
 * answers them with `501 feature_unavailable`.
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

/** Roles an admin may grant; `owner` only changes through ownership transfer. */
export const ASSIGNABLE_WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const;

// ==================== Path / Query Schemas ====================

export const WorkspaceIdParamSchema = z.object({
  id: z.string().min(1).describe('Workspace id'),
});
export type WorkspaceIdParam = z.infer<typeof WorkspaceIdParamSchema>;

export const WorkspaceMemberParamSchema = WorkspaceIdParamSchema.extend({
  userId: z.string().min(1).describe('User id of the member'),
});
export type WorkspaceMemberParam = z.infer<typeof WorkspaceMemberParamSchema>;

export const WorkspaceInvitationParamSchema = WorkspaceIdParamSchema.extend({
  invitationId: z.string().min(1).describe('Invitation id'),
});
export type WorkspaceInvitationParam = z.infer<typeof WorkspaceInvitationParamSchema>;

export const WorkspaceListQuerySchema = CursorPaginationQuerySchema;
export type WorkspaceListQuery = z.infer<typeof WorkspaceListQuerySchema>;

export const AuditLogListQuerySchema = CursorPaginationQuerySchema.extend({
  cursor: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("The previous page's `nextCursor`. Omit for the first page."),
  action: z.string().min(1).max(100).optional().describe('Only this action, e.g. `member.invited`'),
  endDate: dateTimeSchema.optional().describe('Only entries at or before this instant'),
  q: z.string().min(1).max(200).optional().describe('Free-text search over the entries'),
  resourceType: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Only entries about this resource type, e.g. `page`'),
  startDate: dateTimeSchema.optional().describe('Only entries at or after this instant'),
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;

// ==================== Request Schemas ====================

export const UpdateWorkspaceRequestSchema = z
  .object({
    avatar: z.string().max(2048).optional(),
    description: z.string().max(1000).optional(),
    name: z.string().min(1).max(255).optional(),
    slug: z
      .string()
      .min(WORKSPACE_SLUG_MIN)
      .max(WORKSPACE_SLUG_MAX)
      .refine(isWorkspaceSlugFormatValid, { message: 'invalid-slug' })
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field' });
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequestSchema>;

export const UpdateWorkspaceMemberRequestSchema = z
  .object({ role: z.enum(ASSIGNABLE_WORKSPACE_ROLES) })
  .strict();
export type UpdateWorkspaceMemberRequest = z.infer<typeof UpdateWorkspaceMemberRequestSchema>;

export const CreateWorkspaceInvitationRequestSchema = z
  .object({
    email: z
      .email()
      .optional()
      .describe('Invite this address. Omit to mint a shareable invite link instead.'),
    role: z.enum(ASSIGNABLE_WORKSPACE_ROLES).default('member'),
  })
  .strict();
export type CreateWorkspaceInvitationRequest = z.infer<
  typeof CreateWorkspaceInvitationRequestSchema
>;

// ==================== Response Schemas ====================

export const WorkspaceSchema = z
  .object({
    avatar: z.string().nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    plan: z.string().nullable().describe('Subscription plan tag, e.g. `free`, `pro`, `business`'),
    primaryOwnerId: z.string().nullable(),
    role: z.enum(WORKSPACE_ROLES).nullable().describe("The caller's role in this workspace"),
    slug: z.string(),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'Workspace' });
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceListResponseSchema = paginatedListSchema(WorkspaceSchema, { total: true });

export const UserProfileSchema = z
  .object({
    avatar: z.string().nullable(),
    email: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    username: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'UserProfile' });
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const WorkspaceMemberSchema = z
  .object({
    joinedAt: dateTimeSchema,
    responsibilities: z.string().nullable(),
    role: z.enum(WORKSPACE_ROLES).nullable().describe('`null` when no role could be resolved'),
    title: z.string().nullable(),
    user: UserProfileSchema.nullable(),
    userId: z.string(),
  })
  .strict()
  .meta({ id: 'WorkspaceMember' });
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceMemberListResponseSchema = paginatedListSchema(WorkspaceMemberSchema, {
  total: true,
});

export const WorkspaceInvitationSchema = z
  .object({
    createdAt: dateTimeSchema,
    email: z.string().nullable().describe('`null` for a shareable invite link'),
    expiresAt: dateTimeSchema.nullable(),
    id: z.string(),
    inviterId: z.string().nullable(),
    reusable: z.boolean(),
    role: z.enum(ASSIGNABLE_WORKSPACE_ROLES).nullable(),
    status: z.string().describe('`pending`, `accepted`, `revoked` or `expired`'),
    token: z
      .string()
      .describe('Invitation token; the invite link carries it. Treat it as a secret.'),
  })
  .strict()
  .meta({ id: 'WorkspaceInvitation' });
export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;

export const WorkspaceInvitationListResponseSchema = paginatedListSchema(
  WorkspaceInvitationSchema,
  { total: true },
);

export const WorkspaceAuditLogSchema = z
  .object({
    action: z.string(),
    createdAt: dateTimeSchema,
    id: z.string(),
    ipAddress: z.string().nullable(),
    metadata: jsonObjectSchema,
    resourceId: z.string().nullable(),
    resourceType: z.string().nullable(),
    userId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'WorkspaceAuditLog' });
export type WorkspaceAuditLog = z.infer<typeof WorkspaceAuditLogSchema>;

export const WorkspaceAuditLogListResponseSchema = paginatedListSchema(WorkspaceAuditLogSchema);
