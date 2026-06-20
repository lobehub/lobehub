import { TRPCError } from '@trpc/server';

import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { WorkspaceMemberItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { isSuperAdmin } from '../enterprise/superAdmin';

export interface WorkspaceControlContext {
  serverDB: LobeChatDatabase;
  userId: string;
}

export const getWorkspaceControl = (ctx: WorkspaceControlContext) => ({
  memberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
  workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
});

export const assertWorkspaceMember = async (ctx: WorkspaceControlContext, workspaceId: string) => {
  const { memberModel } = getWorkspaceControl(ctx);
  const membership = await memberModel.getMember(workspaceId, ctx.userId);
  if (!membership && (await isSuperAdmin(ctx.serverDB, ctx.userId))) {
    return {
      deletedAt: null,
      joinedAt: new Date(0),
      role: 'owner',
      updatedAt: new Date(0),
      userId: ctx.userId,
      workspaceId,
    } satisfies WorkspaceMemberItem;
  }

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Нет доступа к этому рабочему пространству',
    });
  }

  return membership;
};

export const assertWorkspaceOwner = async (ctx: WorkspaceControlContext, workspaceId: string) => {
  const membership = await assertWorkspaceMember(ctx, workspaceId);
  if (membership.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Требуется роль владельца workspace' });
  }

  return membership;
};

export const getWorkspaceSettings = async (ctx: WorkspaceControlContext, workspaceId: string) => {
  const { workspaceModel } = getWorkspaceControl(ctx);
  return (await workspaceModel.getSettings(workspaceId)) as Record<string, unknown>;
};

export const updateWorkspaceSettings = async (
  ctx: WorkspaceControlContext,
  workspaceId: string,
  patch: Record<string, unknown>,
) => {
  const { workspaceModel } = getWorkspaceControl(ctx);
  const settings = await getWorkspaceSettings(ctx, workspaceId);
  await workspaceModel.updateSettings(workspaceId, { ...settings, ...patch });
};
