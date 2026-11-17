import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { pageOf, WorkspaceRestService } from '../services/workspace.service';
import type {
  AuditLogListQuery,
  CreateWorkspaceInvitationRequest,
  UpdateWorkspaceMemberRequest,
  UpdateWorkspaceRequest,
  WorkspaceIdParam,
  WorkspaceInvitationParam,
  WorkspaceListQuery,
  WorkspaceMemberParam,
} from '../types/workspace.type';

/**
 * Workspaces controller.
 * Handles HTTP concerns only — the rules live in the cloud workspace routers.
 */
export class WorkspaceController extends BaseController {
  private async service(c: Context): Promise<WorkspaceRestService> {
    return new WorkspaceRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  private async run(c: Context, handler: () => Promise<Response>): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/workspaces */
  listWorkspaces(c: Context) {
    return this.run(c, async () => {
      const query = this.getQuery<WorkspaceListQuery>(c);
      const workspaces = await (await this.service(c)).listWorkspaces();
      return this.list(c, 'items', pageOf(workspaces, query), {
        message: 'Workspace list retrieved successfully',
        pagination: query,
      });
    });
  }

  /** GET /api/v1/workspaces/:id */
  getWorkspace(c: Context) {
    return this.run(c, async () => {
      const { id } = this.getParams<WorkspaceIdParam>(c);
      return this.success(c, await (await this.service(c)).getWorkspace(id));
    });
  }

  /** PATCH /api/v1/workspaces/:id */
  updateWorkspace(c: Context) {
    return this.run(c, async () => {
      const { id } = this.getParams<WorkspaceIdParam>(c);
      const body = await this.getBody<UpdateWorkspaceRequest>(c);
      return this.success(
        c,
        await (await this.service(c)).updateWorkspace(id, body),
        'Workspace updated',
      );
    });
  }

  /** GET /api/v1/workspaces/:id/members */
  listMembers(c: Context) {
    return this.run(c, async () => {
      const { id } = this.getParams<WorkspaceIdParam>(c);
      const query = this.getQuery<WorkspaceListQuery>(c);
      const members = await (await this.service(c)).listMembers(id);
      return this.list(c, 'items', pageOf(members, query), { pagination: query });
    });
  }

  /** PATCH /api/v1/workspaces/:id/members/:userId */
  updateMember(c: Context) {
    return this.run(c, async () => {
      const { id, userId } = this.getParams<WorkspaceMemberParam>(c);
      const body = await this.getBody<UpdateWorkspaceMemberRequest>(c);
      return this.success(
        c,
        await (await this.service(c)).updateMember(id, userId, body),
        'Member role updated',
      );
    });
  }

  /** DELETE /api/v1/workspaces/:id/members/:userId */
  removeMember(c: Context) {
    return this.run(c, async () => {
      const { id, userId } = this.getParams<WorkspaceMemberParam>(c);
      return this.success(
        c,
        await (await this.service(c)).removeMember(id, userId),
        'Member removed',
      );
    });
  }

  /** GET /api/v1/workspaces/:id/invitations */
  listInvitations(c: Context) {
    return this.run(c, async () => {
      const { id } = this.getParams<WorkspaceIdParam>(c);
      const query = this.getQuery<WorkspaceListQuery>(c);
      const invitations = await (await this.service(c)).listInvitations(id);
      return this.list(c, 'items', pageOf(invitations, query), { pagination: query });
    });
  }

  /** POST /api/v1/workspaces/:id/invitations */
  createInvitation(c: Context) {
    return this.run(c, async () => {
      const { id } = this.getParams<WorkspaceIdParam>(c);
      const body = await this.getBody<CreateWorkspaceInvitationRequest>(c);
      return this.success(
        c,
        await (await this.service(c)).createInvitation(id, body),
        'Invitation created',
        201,
      );
    });
  }

  /** DELETE /api/v1/workspaces/:id/invitations/:invitationId */
  revokeInvitation(c: Context) {
    return this.run(c, async () => {
      const { id, invitationId } = this.getParams<WorkspaceInvitationParam>(c);
      return this.success(
        c,
        await (await this.service(c)).revokeInvitation(id, invitationId),
        'Invitation revoked',
      );
    });
  }

  /** GET /api/v1/workspaces/:id/audit-logs */
  listAuditLogs(c: Context) {
    return this.run(c, async () => {
      const { id } = this.getParams<WorkspaceIdParam>(c);
      const query = this.getQuery<AuditLogListQuery>(c);
      return this.success(c, await (await this.service(c)).listAuditLogs(id, query));
    });
  }
}
