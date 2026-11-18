import { workspaceRouter } from '@/business/server/lambda-routers/workspace';
import { workspaceAuditLogRouter } from '@/business/server/lambda-routers/workspaceAuditLog';
import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import type { PaginationRequest } from '../helpers/pagination';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  AuditLogListQuery,
  CreateWorkspaceInvitationRequest,
  UpdateWorkspaceMemberRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceAuditLog,
  WorkspaceInvitation,
  WorkspaceMember,
} from '../types/workspace.type';

/** `Date` (or an ISO string that already crossed a JSON boundary) as ISO 8601. */
export const toIso = (value: Date | string): string => new Date(value).toISOString();
const toIsoOrNull = (value: Date | string | null | undefined) => (value ? toIso(value) : null);

type WorkspaceRole = Workspace['role'] & string;
const asRole = <T extends string>(role: string | null | undefined, allowed: readonly T[]) =>
  (allowed as readonly string[]).includes(role ?? '') ? (role as T) : null;

/** Slice an in-memory list (the tRPC procedures return whole lists) into one cursor page. */
export const pageOf = <T>(items: T[], query: PaginationRequest) => {
  const { limit, offset } = resolvePagination(query);
  return { items: items.slice(offset, offset + limit), total: items.length };
};

interface WorkspaceRow {
  avatar?: string | null;
  createdAt: Date | string;
  description?: string | null;
  id: string;
  name: string;
  plan?: string | null;
  primaryOwnerId?: string | null;
  role?: string | null;
  slug: string;
  updatedAt: Date | string;
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  avatar: row.avatar ?? null,
  createdAt: toIso(row.createdAt),
  description: row.description ?? null,
  id: row.id,
  name: row.name,
  plan: row.plan ?? null,
  primaryOwnerId: row.primaryOwnerId ?? null,
  role: asRole<WorkspaceRole>(row.role, ['owner', 'admin', 'member', 'viewer']),
  slug: row.slug,
  updatedAt: toIso(row.updatedAt),
});

interface MemberRow {
  joinedAt: Date | string;
  responsibilities?: string | null;
  role: string | null;
  title?: string | null;
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
  userId: string;
}

const toMember = (row: MemberRow): WorkspaceMember => ({
  joinedAt: toIso(row.joinedAt),
  responsibilities: row.responsibilities ?? null,
  role: asRole(row.role, ['owner', 'admin', 'member', 'viewer'] as const),
  title: row.title ?? null,
  user: row.user
    ? {
        avatar: row.user.avatar,
        email: row.user.email,
        fullName: row.user.fullName,
        id: row.userId,
        username: row.user.username,
      }
    : null,
  userId: row.userId,
});

interface InvitationRow {
  createdAt: Date | string;
  email: string | null;
  expiresAt: Date | string | null;
  id: string;
  inviterId: string | null;
  reusable: boolean;
  role: string;
  status: string;
  token: string;
}

const toInvitation = (row: InvitationRow): WorkspaceInvitation => ({
  createdAt: toIso(row.createdAt),
  email: row.email,
  expiresAt: toIsoOrNull(row.expiresAt),
  id: row.id,
  inviterId: row.inviterId,
  reusable: row.reusable,
  role: asRole(row.role, ['admin', 'member', 'viewer'] as const),
  status: row.status,
  token: row.token,
});

interface AuditLogRow {
  action: string;
  createdAt: Date | string;
  id: string;
  ipAddress: string | null;
  metadata: unknown;
  resourceId: string | null;
  resourceType: string | null;
  userId: string | null;
}

const toAuditLog = (row: AuditLogRow): WorkspaceAuditLog => ({
  action: row.action,
  createdAt: toIso(row.createdAt),
  id: row.id,
  ipAddress: row.ipAddress,
  metadata:
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {},
  resourceId: row.resourceId,
  resourceType: row.resourceType,
  userId: row.userId,
});

/**
 * Workspaces REST service.
 *
 * Calls the `workspace` / `workspaceMember` / `workspaceAuditLog` tRPC routers
 * server-side — on cloud those are the real implementations (role checks,
 * seat limits, primary-owner protection, invitation emails, audit entries);
 * in the open-source build they are stubs and the routes never get here
 * (`requireBusinessFeature`). The context carries no API-key scopes: the REST
 * route has already narrowed the key.
 */
export class WorkspaceRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private caller<R extends { createCaller: (ctx: any) => any }>(
    router: R,
    workspaceId?: string,
  ): ReturnType<R['createCaller']> {
    return router.createCaller({ userId: this.userId, workspaceId });
  }

  /** Every workspace the caller belongs to — or only the bound one for a workspace-scoped request. */
  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.caller(workspaceRouter).list();
    const workspaces = (rows as WorkspaceRow[]).map(toWorkspace);
    return this.workspaceId ? workspaces.filter((w) => w.id === this.workspaceId) : workspaces;
  }

  async getWorkspace(id: string): Promise<Workspace> {
    const workspace = (await this.listWorkspaces()).find((item) => item.id === id);
    if (!workspace) throw this.createNotFoundError('Workspace not found');
    return workspace;
  }

  async updateWorkspace(id: string, body: UpdateWorkspaceRequest): Promise<Workspace> {
    await this.caller(workspaceRouter, id).update(body);
    return this.getWorkspace(id);
  }

  // ==================== Members ====================

  async listMembers(id: string): Promise<WorkspaceMember[]> {
    const rows = await this.caller(workspaceMemberRouter, id).list();
    return (rows as MemberRow[]).map(toMember);
  }

  async updateMember(
    id: string,
    userId: string,
    body: UpdateWorkspaceMemberRequest,
  ): Promise<WorkspaceMember> {
    await this.caller(workspaceMemberRouter, id).updateRole({ role: body.role, userId });
    const member = (await this.listMembers(id)).find((item) => item.userId === userId);
    if (!member) throw this.createNotFoundError('Member not found');
    return member;
  }

  async removeMember(id: string, userId: string): Promise<DeletedResource> {
    await this.caller(workspaceMemberRouter, id).remove({ userId });
    return { deleted: true, id: userId };
  }

  // ==================== Invitations ====================

  async listInvitations(id: string): Promise<WorkspaceInvitation[]> {
    const rows = await this.caller(workspaceMemberRouter, id).listInvitations();
    return (rows as InvitationRow[]).map(toInvitation);
  }

  async createInvitation(
    id: string,
    body: CreateWorkspaceInvitationRequest,
  ): Promise<WorkspaceInvitation> {
    const row = await this.caller(workspaceMemberRouter, id).invite({
      email: body.email,
      role: body.role,
    });
    return toInvitation(row as InvitationRow);
  }

  async revokeInvitation(id: string, invitationId: string): Promise<DeletedResource> {
    await this.caller(workspaceMemberRouter, id).revokeInvitation({ id: invitationId });
    return { deleted: true, id: invitationId };
  }

  // ==================== Audit log ====================

  async listAuditLogs(
    id: string,
    query: AuditLogListQuery,
  ): Promise<{ hasMore: boolean; items: WorkspaceAuditLog[]; nextCursor: string | null }> {
    const { cursor, limit, ...filters } = query;
    const page = await this.caller(workspaceAuditLogRouter, id).list({
      ...filters,
      cursor,
      limit: limit ?? 20,
    });
    const nextCursor = page.nextCursor ?? null;
    return {
      hasMore: nextCursor !== null,
      items: (page.items as AuditLogRow[]).map(toAuditLog),
      nextCursor,
    };
  }
}
