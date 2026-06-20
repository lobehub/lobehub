import { and, eq, isNull } from 'drizzle-orm';

import { isSuperAdmin } from '@/business/server/enterprise/superAdmin';
import { workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export const WORKSPACE_ID_HEADER = 'X-Workspace-Id';

export const resolveValidWorkspaceIdFromRequest = async (params: {
  req: Request;
  serverDB: LobeChatDatabase;
  userId: string;
}): Promise<string | undefined> => {
  const workspaceId = params.req.headers.get(WORKSPACE_ID_HEADER)?.trim();
  if (!workspaceId) return undefined;

  const workspace = await params.serverDB.query.workspaces.findFirst({
    columns: { id: true },
    where: eq(workspaces.id, workspaceId),
  });
  if (!workspace) return undefined;

  if (await isSuperAdmin(params.serverDB, params.userId)) return workspaceId;

  const membership = await params.serverDB.query.workspaceMembers.findFirst({
    columns: { userId: true },
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, params.userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  return membership ? workspaceId : undefined;
};
