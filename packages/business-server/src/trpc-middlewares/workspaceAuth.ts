import { authedProcedure } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'member' | 'owner' | 'viewer';

export const cloudWorkspaceAuth = trpc.middleware(async (opts) => opts.next());

export const lobeWorkspaceAuth = trpc.middleware(async (opts) => opts.next());

export const requireWorkspaceRole = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => opts.next());

export const requireWorkspaceRoleWhenScoped = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => opts.next());

export const wsProcedure = authedProcedure;

export const wsMemberProcedure = authedProcedure;

export const wsOwnerProcedure = authedProcedure;

export const wsCompatProcedure = authedProcedure;
