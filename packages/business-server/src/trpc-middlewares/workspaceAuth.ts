import { TRPCError } from '@trpc/server';

import { authedProcedure } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'member' | 'owner' | 'viewer';

export const cloudWorkspaceAuth = trpc.middleware(async (opts) => opts.next());

export const lobeWorkspaceAuth = trpc.middleware(async (opts) => opts.next());

export const requireWorkspaceRole = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => opts.next());

export const requireWorkspaceRoleWhenScoped = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => opts.next());

const requireWorkspaceId = trpc.middleware(async ({ ctx, next }) => {
  if (!ctx.workspaceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
  }
  return next({ ctx: { workspaceId: ctx.workspaceId } });
});

export const wsProcedure = authedProcedure.use(requireWorkspaceId);

export const wsMemberProcedure = authedProcedure;

export const wsOwnerProcedure = authedProcedure.use(requireWorkspaceId);

export const wsCompatProcedure = authedProcedure;
