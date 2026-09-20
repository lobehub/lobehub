import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  ScmChangeRequestModel,
  ScmIdentityModel,
  ScmInstallationModel,
} from '@/database/models/scm';
import { scmEnv } from '@/envs/scm';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/** Path the "Connect GitHub" button navigates to; the server route owns the redirect. */
export const GITHUB_INSTALL_PATH = '/api/webhooks/github/install';

const scmProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { scope: { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null } },
  });
});

/**
 * Read side of the SCM integration for the settings page and acceptance
 * views. Writes happen through provider webhooks and the install callback,
 * never through this router.
 */
export const scmRouter = router({
  /** What the client needs to render the connect button. */
  getConfig: scmProcedure.query(async () => ({
    github: {
      appSlug: scmEnv.GITHUB_APP_SLUG ?? null,
      enabled: scmEnv.ENABLED_GITHUB_APP,
      installPath: GITHUB_INSTALL_PATH,
    },
  })),

  /** The caller's own provider identity, without credentials. */
  getIdentity: scmProcedure
    .input(z.object({ provider: z.enum(['github']) }))
    .query(async ({ ctx, input }) => {
      const identity = await ScmIdentityModel.findByUser(ctx.serverDB, input.provider, ctx.userId);
      if (!identity) return null;
      return {
        avatarUrl: identity.metadata.avatarUrl ?? null,
        externalLogin: identity.externalLogin,
        externalUserId: identity.externalUserId,
        provider: identity.provider,
      };
    }),

  listChangeRequests: scmProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) =>
      ScmChangeRequestModel.listByScope(ctx.serverDB, ctx.scope, { limit: input?.limit }),
    ),

  listInstallations: scmProcedure.query(async ({ ctx }) =>
    ScmInstallationModel.listByScope(ctx.serverDB, ctx.scope),
  ),
});

export type ScmRouter = typeof scmRouter;
