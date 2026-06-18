import debug from 'debug';
import { and, eq, isNull } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { workspaceMembers, workspaces } from '@/database/schemas';

const log = debug('lobe-hono:workspace-middleware');

export const OPENAPI_WORKSPACE_HEADER = 'X-Workspace-Id';

export const workspaceAuthMiddleware = async (c: Context, next: Next) => {
  const workspaceId = c.req.header(OPENAPI_WORKSPACE_HEADER)?.trim();

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

  c.set('workspaceId', workspaceId);
  c.set('workspaceRole', membership.role);
  return next();
};
