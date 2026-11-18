import { TRPCError } from '@trpc/server';

import { authedProcedure } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'admin' | 'member' | 'owner' | 'viewer';

export const cloudWorkspaceAuth = trpc.middleware(async (opts) =>
  opts.next({
    ctx: {
      workspaceSlug: undefined as string | undefined,
    },
  }),
);

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
export const wsAdminProcedure = authedProcedure.use(requireWorkspaceId);

export const wsCompatProcedure = authedProcedure.use(cloudWorkspaceAuth);

/**
 * `cloudWorkspaceAuth` for the only routers an external contact of a workspace may reach: the
 * address book and Channels. Cloud admits a non-member paired with a member of the requested
 * workspace there, with `isExternalContact` and no role; every other router keeps treating them
 * as personal. Outside Cloud nobody is an external contact.
 */
export const externalContactWorkspaceAuth = trpc.middleware(async (opts) =>
  opts.next({
    ctx: {
      isExternalContact: false as boolean,
      workspaceSlug: undefined as string | undefined,
    },
  }),
);

export const wsExternalCompatProcedure = authedProcedure.use(externalContactWorkspaceAuth);

/**
 * Refuses a workspace's external contact. Routers on `wsExternalCompatProcedure` put it on every
 * procedure except the few an external contact needs, so a new procedure is closed to them until
 * someone opens it on purpose.
 */
export const denyExternalContact = trpc.middleware(async ({ ctx, next }) => {
  if ((ctx as { isExternalContact?: boolean }).isExternalContact)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not available to external contacts' });
  return next();
});
