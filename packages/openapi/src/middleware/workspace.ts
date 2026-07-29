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

  if (c.get('authType') === 'apikey') {
    // `workspace_members.role` is the single source of truth for built-in
    // workspace roles (LOBE-12329).
    const isWorkspaceAdmin = membership.role === 'owner' || membership.role === 'admin';

    if (!isWorkspaceAdmin) {
      throw new HTTPException(403, {
        message: 'Workspace API Key requires an admin account',
      });
    }

    if (!(await canUseWorkspaceApiKeys(workspaceId))) {
      throw new HTTPException(403, {
        message: 'Workspace API Key access is not available',
      });
    }
  }

  c.set('workspaceId', workspaceId);
  c.set('workspaceRole', membership.role);
  return next();
};
