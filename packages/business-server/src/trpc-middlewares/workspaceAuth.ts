import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { workspaceMembers } from '@/database/schemas';
import { authedProcedure } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'member' | 'owner' | 'viewer';

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  owner: 2,
};

const assertWorkspaceRole = async (params: {
  minRole: WorkspaceRole;
  userId: string;
  workspaceId?: string | null;
}) => {
  if (!params.workspaceId) return null;

  const db = await getServerDB();
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, params.workspaceId),
      eq(workspaceMembers.userId, params.userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this workspace' });
  }

  const role = membership.role as WorkspaceRole;
  if (roleRank[role] < roleRank[params.minRole]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient workspace role' });
  }

  return role;
};

export const cloudWorkspaceAuth = trpc.middleware(async (opts) => {
  if (!opts.ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

  await assertWorkspaceRole({
    minRole: 'viewer',
    userId: opts.ctx.userId,
    workspaceId: opts.ctx.workspaceId,
  });

  return opts.next();
});

export const lobeWorkspaceAuth = cloudWorkspaceAuth;

export const requireWorkspaceRole = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => {
    if (!opts.ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

    await assertWorkspaceRole({
      minRole: _minRole,
      userId: opts.ctx.userId,
      workspaceId: opts.ctx.workspaceId,
    });

    return opts.next();
  });

export const requireWorkspaceRoleWhenScoped = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => {
    if (opts.ctx.workspaceId) {
      if (!opts.ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

      await assertWorkspaceRole({
        minRole: _minRole,
        userId: opts.ctx.userId,
        workspaceId: opts.ctx.workspaceId,
      });
    }

    return opts.next();
  });

export const wsProcedure = authedProcedure;

export const wsMemberProcedure = authedProcedure;

export const wsOwnerProcedure = authedProcedure;

export const wsCompatProcedure = authedProcedure;
