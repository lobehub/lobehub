import debug from 'debug';
import { and, eq, isNull } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { canUseWorkspaceApiKeys } from '@/business/server/workspaceApiKey';
import { getServerDB } from '@/database/core/db-adaptor';
import { workspaceMembers, workspaces } from '@/database/schemas';

const log = debug('lobe-hono:workspace-middleware');

export const OPENAPI_WORKSPACE_HEADER = 'X-Workspace-Id';

const resolveWorkspaceId = (c: Context): string | undefined => {
  const requestedWorkspaceId = c.req.header(OPENAPI_WORKSPACE_HEADER)?.trim() || undefined;

  if (c.get('authType') !== 'apikey') return requestedWorkspaceId;

  const apiKeyWorkspaceId = c.get('apiKeyWorkspaceId') as string | null | undefined;

  if (!apiKeyWorkspaceId) {
    if (requestedWorkspaceId) {
      throw new HTTPException(403, {
        message: 'Personal API Key cannot access workspace data',
      });
    }

    return;
  }

  if (requestedWorkspaceId && requestedWorkspaceId !== apiKeyWorkspaceId) {
    throw new HTTPException(403, {
      message: 'Workspace API Key cannot access a different workspace',
    });
  }

  return apiKeyWorkspaceId;
};

/**
 * Built-in workspace roles, lowest to highest. `workspace_members.role` is the
 * single source of truth, so ordering here is the whole role model.
 */
const WORKSPACE_ROLE_ORDER = ['viewer', 'member', 'admin', 'owner'];

const hasMinWorkspaceRole = (role: string | undefined, minRole: string) =>
  !!role && WORKSPACE_ROLE_ORDER.indexOf(role) >= WORKSPACE_ROLE_ORDER.indexOf(minRole);

/**
 * Require at least `minRole` for workspace-scoped requests; personal requests
 * pass through untouched.
 *
 * `workspaceAuthMiddleware` only enforces the admin role for `apikey` auth, so
 * without this an OIDC/session-authenticated member could reach routes whose
 * models use a workspace-wide (not row-owner) predicate. Mirrors the tRPC
 * `requireWorkspaceRoleWhenScoped` guard so both transports gate identically.
 */
export const requireWorkspaceRoleWhenScoped =
  (minRole: 'admin' | 'owner') => async (c: Context, next: Next) => {
    if (!c.get('workspaceId')) return next();

    if (!hasMinWorkspaceRole(c.get('workspaceRole'), minRole)) {
      throw new HTTPException(403, { message: `Requires ${minRole} role or higher` });
    }

    return next();
  };

export const workspaceAuthMiddleware = async (c: Context, next: Next) => {
  const workspaceId = resolveWorkspaceId(c);

  if (!workspaceId) {
    c.set('workspaceId', undefined);
    c.set('workspaceRole', undefined);
    return next();
  }

  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, {
      message: 'Authentication required for workspace access',
    });
  }

  const serverDB = await getServerDB();
  const workspace = await serverDB.query.workspaces.findFirst({
    columns: { id: true },
    where: eq(workspaces.id, workspaceId),
  });

  if (!workspace) {
    throw new HTTPException(404, {
      message: 'Workspace not found',
    });
  }

  const membership = await serverDB.query.workspaceMembers.findFirst({
    columns: { role: true },
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  if (!membership) {
    log('Workspace membership check failed for user %s workspace %s', userId, workspaceId);
    throw new HTTPException(403, {
      message: 'Not a member of this workspace',
    });
  }

  if (c.get('authType') === 'apikey' && !(await canUseWorkspaceApiKeys(workspaceId))) {
    throw new HTTPException(403, {
      message: 'Workspace API Key access is not available',
    });
  }

  c.set('workspaceId', workspaceId);
  c.set('workspaceRole', membership.role);
  return next();
};
