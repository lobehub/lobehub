import { API_KEY_FULL_ACCESS_SCOPE } from '@lobechat/const';
import { Hono } from 'hono';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { WorkspaceController } from '../controllers/workspace.controller';
import { requireAuth } from '../middleware/auth';
import { requireBusinessFeature } from '../middleware/business-feature';
import { requireApiKeyScope } from '../middleware/permission-check';
import { workspaceFromPath } from '../middleware/workspace';
import { DeletedResourceSchema } from '../types/common.type';
import {
  AuditLogListQuerySchema,
  CreateWorkspaceInvitationRequestSchema,
  UpdateWorkspaceMemberRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceAuditLogListResponseSchema,
  WorkspaceIdParamSchema,
  WorkspaceInvitationListResponseSchema,
  WorkspaceInvitationParamSchema,
  WorkspaceInvitationSchema,
  WorkspaceListQuerySchema,
  WorkspaceListResponseSchema,
  WorkspaceMemberListResponseSchema,
  WorkspaceMemberParamSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
} from '../types/workspace.type';

/**
 * Workspace routes: team workspaces, members, invitations and the audit log.
 *
 * The workspace named in the path is the request's workspace context
 * (`workspaceFromPath`): it must agree with a workspace-bound API key or an
 * `X-Workspace-Id` header, and the caller must be a member. Role rules (admin
 * or higher to manage members, Business plan for the audit log) are enforced
 * by the cloud workspace routers these routes call.
 *
 * API key scopes: reads need `workspace:read`, workspace settings
 * `workspace:write`. Member and invitation changes are privilege management,
 * which a restricted key never reaches (the same rule the tRPC surface applies
 * to `workspaceMember`), so they need a full-access key.
 *
 * Self-hosted (open-source) deployments have no team workspaces and answer
 * every route here with `501 feature_unavailable`.
 */
const WorkspaceRoutes = new Hono();

const businessOnly = requireBusinessFeature('Team workspaces');
const workspaceRead = requireApiKeyScope('workspace:read');
const workspaceWrite = requireApiKeyScope('workspace:write');
const memberManage = requireApiKeyScope(API_KEY_FULL_ACCESS_SCOPE);
const inPathWorkspace = workspaceFromPath('id');

const TAGS = ['workspaces'];

const WORKSPACE_EXAMPLE = {
  avatar: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  description: 'Platform team',
  id: 'ws_abc123',
  name: 'Acme',
  plan: 'business',
  primaryOwnerId: 'user_owner',
  role: 'owner',
  slug: 'acme',
  updatedAt: '2026-01-02T00:00:00.000Z',
} as const;

/** GET /api/v1/workspaces — the workspaces the caller belongs to. */
WorkspaceRoutes.get(
  '/',
  routeDoc({
    data: WorkspaceListResponseSchema,
    description:
      'Workspaces the caller is a member of, with their role in each. A workspace-bound API key (or an `X-Workspace-Id` header) narrows the list to that workspace.',
    errors: [501],
    summary: 'List workspaces',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  workspaceRead,
  zValidator('query', WorkspaceListQuerySchema),
  async (c) => new WorkspaceController().listWorkspaces(c),
);

/** GET /api/v1/workspaces/:id */
WorkspaceRoutes.get(
  '/:id',
  routeDoc({
    data: WorkspaceSchema,
    errors: [404, 501],
    responseExample: WORKSPACE_EXAMPLE,
    summary: 'Get a workspace',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceIdParamSchema),
  inPathWorkspace,
  workspaceRead,
  async (c) => new WorkspaceController().getWorkspace(c),
);

/** PATCH /api/v1/workspaces/:id — rename, re-slug, describe. Admin or higher. */
WorkspaceRoutes.patch(
  '/:id',
  routeDoc({
    data: WorkspaceSchema,
    description: 'Updates the workspace name, slug, description or avatar. Admin or higher.',
    errors: [404, 409, 501],
    requestExample: example(UpdateWorkspaceRequestSchema, { name: 'Acme Platform' }),
    summary: 'Update a workspace',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceIdParamSchema),
  inPathWorkspace,
  workspaceWrite,
  zValidator('json', UpdateWorkspaceRequestSchema),
  async (c) => new WorkspaceController().updateWorkspace(c),
);

// ==================== Members ====================

/** GET /api/v1/workspaces/:id/members */
WorkspaceRoutes.get(
  '/:id/members',
  routeDoc({
    data: WorkspaceMemberListResponseSchema,
    errors: [404, 501],
    summary: 'List workspace members',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceIdParamSchema),
  inPathWorkspace,
  workspaceRead,
  zValidator('query', WorkspaceListQuerySchema),
  async (c) => new WorkspaceController().listMembers(c),
);

/** PATCH /api/v1/workspaces/:id/members/:userId — change a member's role. */
WorkspaceRoutes.patch(
  '/:id/members/:userId',
  routeDoc({
    data: WorkspaceMemberSchema,
    description:
      "Changes a member's role. Admin or higher; the owner role only changes through ownership transfer.",
    errors: [404, 501],
    operationId: 'workspaces.updateMemberRole',
    requestExample: example(UpdateWorkspaceMemberRequestSchema, { role: 'admin' }),
    summary: "Change a member's role",
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceMemberParamSchema),
  inPathWorkspace,
  memberManage,
  zValidator('json', UpdateWorkspaceMemberRequestSchema),
  async (c) => new WorkspaceController().updateMember(c),
);

/** DELETE /api/v1/workspaces/:id/members/:userId */
WorkspaceRoutes.delete(
  '/:id/members/:userId',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Removes a member from the workspace. Admin or higher; the primary owner cannot be removed, and you leave a workspace rather than removing yourself.',
    errors: [404, 501],
    operationId: 'workspaces.removeMember',
    summary: 'Remove a member',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceMemberParamSchema),
  inPathWorkspace,
  memberManage,
  async (c) => new WorkspaceController().removeMember(c),
);

// ==================== Invitations ====================

/** GET /api/v1/workspaces/:id/invitations — pending invitations. Admin or higher. */
WorkspaceRoutes.get(
  '/:id/invitations',
  routeDoc({
    data: WorkspaceInvitationListResponseSchema,
    description: 'Pending invitations of the workspace. Admin or higher.',
    errors: [404, 501],
    summary: 'List pending invitations',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceIdParamSchema),
  inPathWorkspace,
  workspaceRead,
  zValidator('query', WorkspaceListQuerySchema),
  async (c) => new WorkspaceController().listInvitations(c),
);

/** POST /api/v1/workspaces/:id/invitations */
WorkspaceRoutes.post(
  '/:id/invitations',
  routeDoc({
    data: WorkspaceInvitationSchema,
    description:
      'Invites an email address (an invitation email is sent), or mints a shareable invite link when `email` is omitted. Admin or higher; 409 when the address is already a member or already invited, 403 when the plan has no free seats.',
    errors: [404, 409, 501],
    operationId: 'workspaces.createInvitation',
    requestExample: example(CreateWorkspaceInvitationRequestSchema, {
      email: 'teammate@example.com',
      role: 'member',
    }),
    status: 201,
    summary: 'Invite someone to the workspace',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceIdParamSchema),
  inPathWorkspace,
  memberManage,
  zValidator('json', CreateWorkspaceInvitationRequestSchema),
  async (c) => new WorkspaceController().createInvitation(c),
);

/** DELETE /api/v1/workspaces/:id/invitations/:invitationId */
WorkspaceRoutes.delete(
  '/:id/invitations/:invitationId',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Revokes a pending invitation; its link stops working. Admin or higher.',
    errors: [404, 501],
    operationId: 'workspaces.revokeInvitation',
    summary: 'Revoke an invitation',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceInvitationParamSchema),
  inPathWorkspace,
  memberManage,
  async (c) => new WorkspaceController().revokeInvitation(c),
);

// ==================== Audit log ====================

/** GET /api/v1/workspaces/:id/audit-logs — newest first, cursor-paginated. */
WorkspaceRoutes.get(
  '/:id/audit-logs',
  routeDoc({
    data: WorkspaceAuditLogListResponseSchema,
    description:
      'Workspace audit log, newest first. Pass `nextCursor` back as `cursor` for the next page. Admin or higher, on an active Business plan.',
    errors: [404, 501],
    summary: 'List audit log entries',
    tags: TAGS,
  }),
  requireAuth,
  businessOnly,
  zValidator('param', WorkspaceIdParamSchema),
  inPathWorkspace,
  workspaceRead,
  zValidator('query', AuditLogListQuerySchema),
  async (c) => new WorkspaceController().listAuditLogs(c),
);

export default WorkspaceRoutes;
