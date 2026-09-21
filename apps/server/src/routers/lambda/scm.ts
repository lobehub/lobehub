import { TRPCError } from '@trpc/server';
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
import { fetchGitHubInstallation } from '@/server/services/scm/github/app';
import { consumeScmInstallClaim } from '@/server/services/scm/oauth/stateStore';
import { canWriteScmScope } from '@/server/services/scm/scope';

/** Path the "Connect GitHub" button navigates to; the server route owns the redirect. */
export const GITHUB_INSTALL_PATH = '/api/webhooks/github/install';

const scmProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { scope: { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null } },
  });
});

/**
 * The SCM integration for the settings page and acceptance views. Reads,
 * plus the one write a signed-in user confirms in the app: connecting an
 * installation that reached the callback without our state (started on
 * github.com). Everything else is written by provider webhooks and the
 * install callback.
 */
export const scmRouter = router({
  /**
   * Finish an installation that reached the callback without our state, by
   * redeeming the single-use claim that callback issued. The claim is what
   * authorizes the bind: an installation id proves nothing on its own — it
   * is a small integer, and naming someone else's would hand their
   * repositories to the caller — so a claim minted for another user, or a
   * replayed one, is refused. A workspace additionally needs the member
   * role. No identity is linked here; "Connect account" does that.
   */
  connectInstallation: scmProcedure
    .input(z.object({ claim: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!scmEnv.ENABLED_GITHUB_APP) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'GitHub App is not configured',
        });
      }

      const claim = await consumeScmInstallClaim(input.claim);
      if (!claim || claim.lobeUserId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'this installation claim is expired or was issued for another user',
        });
      }
      if (!(await canWriteScmScope(ctx.serverDB, ctx.userId, ctx.scope.workspaceId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'workspace member role required' });
      }

      let snapshot: Awaited<ReturnType<typeof fetchGitHubInstallation>>;
      try {
        snapshot = await fetchGitHubInstallation(claim.installationId);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'installation not found on GitHub' });
      }

      const existing = await ScmInstallationModel.findByProviderInstallationId(
        ctx.serverDB,
        claim.provider,
        claim.installationId,
      );
      // An installation already bound elsewhere stays there: re-binding it
      // would pull another tenant's repositories into this one.
      if (existing && !existing.revokedAt) {
        const sameScope =
          existing.userId === ctx.userId &&
          (existing.workspaceId ?? null) === ctx.scope.workspaceId;
        if (!sameScope) {
          throw new TRPCError({ code: 'CONFLICT', message: 'installation is connected elsewhere' });
        }
      }

      return ScmInstallationModel.bind(ctx.serverDB, {
        ...snapshot,
        userId: ctx.userId,
        workspaceId: ctx.scope.workspaceId,
      });
    }),

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
