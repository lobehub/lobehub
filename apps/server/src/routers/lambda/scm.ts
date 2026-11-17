import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  ScmChangeRequestModel,
  ScmCredentialGrantModel,
  ScmIdentityModel,
  ScmInstallationModel,
} from '@/database/models/scm';
import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { users } from '@/database/schemas';
import { scmEnv } from '@/envs/scm';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { fetchGitHubInstallation, revokeGitHubUserToken } from '@/server/services/scm/github/app';
import { SCM_MAX_WAKES } from '@/server/services/scm/limits';
import { consumeScmInstallClaim } from '@/server/services/scm/oauth/stateStore';
import {
  listScopeGitHubRepositories,
  ScmRepositoriesUnavailableError,
} from '@/server/services/scm/repositories';
import { canWriteScmScope } from '@/server/services/scm/scope';

import { isWorkspaceConnectorAdmin } from './_helpers/connectorManagePolicy';

/** Path the "Connect GitHub" button navigates to; the server route owns the redirect. */
export const GITHUB_INSTALL_PATH = '/api/webhooks/github/install';
export const GITHUB_AUTHORIZE_PATH = '/api/webhooks/github/authorize';

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

  disconnectIdentity: scmProcedure
    .input(z.object({ provider: z.enum(['github']) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await ScmIdentityModel.findByUser(
        ctx.serverDB,
        input.provider,
        ctx.userId,
        await KeyVaultsGateKeeper.initWithEnvKey(),
      );
      if (!identity) return { disconnected: false };

      await ScmIdentityModel.deleteByUser(ctx.serverDB, input.provider, ctx.userId);
      if (identity.credentials?.accessToken) {
        try {
          await revokeGitHubUserToken(identity.credentials.accessToken);
        } catch {
          // The row is gone either way; an unrevoked token still expires within eight hours.
        }
      }
      return { disconnected: true };
    }),

  /** What the client needs to render the connect button. */
  getConfig: scmProcedure.query(async () => ({
    github: {
      appSlug: scmEnv.GITHUB_APP_SLUG ?? null,
      authorizeEnabled: scmEnv.ENABLED_GITHUB_APP && !!scmEnv.ENABLED_GITHUB_APP_OAUTH,
      authorizePath: GITHUB_AUTHORIZE_PATH,
      enabled: scmEnv.ENABLED_GITHUB_APP,
      installPath: GITHUB_INSTALL_PATH,
    },
  })),

  getRequesterCredentialPolicy: scmProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return { canEdit: false, enabled: false };

    const enabled = await new WorkspaceModel(ctx.serverDB, ctx.userId).getScmRequesterCredential(
      ctx.workspaceId,
    );
    return { canEdit: isWorkspaceConnectorAdmin(ctx), enabled };
  }),

  updateRequesterCredentialPolicy: scmProcedure
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Requester GitHub credentials apply to workspaces only',
        });
      }
      if (!isWorkspaceConnectorAdmin(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only workspace owners and admins can change this policy',
        });
      }
      if (ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Restricted API keys cannot change this policy',
        });
      }

      const workspaceModel = new WorkspaceModel(ctx.serverDB, ctx.userId);
      const previous = await workspaceModel.getScmRequesterCredential(ctx.workspaceId);
      await workspaceModel.updateScmRequesterCredential(ctx.workspaceId, input.enabled);
      await new WorkspaceAuditLogModel(ctx.serverDB).create({
        action: 'security.policy_updated',
        metadata: { policy: 'scm.requester_credential', previous, value: input.enabled },
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return { enabled: input.enabled };
    }),

  listCredentialGrants: scmProcedure
    .input(
      z.object({
        before: z.date().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        repo: z.string().optional(),
        requesterUserId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return [];

      const grants = await ScmCredentialGrantModel.list(ctx.serverDB, {
        ...input,
        requesterUserId: isWorkspaceConnectorAdmin(ctx) ? input.requesterUserId : ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      const requesterIds = [...new Set(grants.map((grant) => grant.requesterUserId))];
      const requesters = requesterIds.length
        ? await ctx.serverDB
            .select({
              avatar: users.avatar,
              fullName: users.fullName,
              id: users.id,
              username: users.username,
            })
            .from(users)
            .where(inArray(users.id, requesterIds))
        : [];
      const byId = new Map(requesters.map((user) => [user.id, user]));

      return grants.map((grant) => {
        const user = byId.get(grant.requesterUserId);
        return {
          ...grant,
          requester: {
            avatar: user?.avatar ?? null,
            id: grant.requesterUserId,
            name: user?.fullName || user?.username || null,
          },
        };
      });
    }),

  /** The caller's own provider identity, without credentials. */
  getIdentity: scmProcedure
    .input(z.object({ provider: z.enum(['github']) }))
    .query(async ({ ctx, input }) => {
      const identity = await ScmIdentityModel.findByUser(
        ctx.serverDB,
        input.provider,
        ctx.userId,
        await KeyVaultsGateKeeper.initWithEnvKey(),
      );
      if (!identity) return null;
      const refreshExpiresAt = identity.credentials?.refreshTokenExpiresAt;
      return {
        avatarUrl: identity.metadata.avatarUrl ?? null,
        externalLogin: identity.externalLogin,
        externalUserId: identity.externalUserId,
        // Mirrors when the credential exchange answers `reauthorize`.
        needsReauthorization:
          !identity.tokenExpiresAt ||
          !identity.credentials?.refreshToken ||
          (!!refreshExpiresAt && Date.parse(refreshExpiresAt) <= Date.now()),
        provider: identity.provider,
      };
    }),

  /**
   * Whether a review or CI event can still wake this conversation. An open
   * conversation polls for that background run only while this holds.
   */
  hasWakeTarget: scmProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!scmEnv.ENABLED_GITHUB_APP) return false;
      return ScmChangeRequestModel.hasWakeTarget(
        ctx.serverDB,
        ctx.scope,
        input.topicId,
        SCM_MAX_WAKES,
      );
    }),

  listChangeRequests: scmProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) =>
      ScmChangeRequestModel.listByScope(ctx.serverDB, ctx.scope, { limit: input?.limit }),
    ),

  listInstallations: scmProcedure.query(async ({ ctx }) =>
    ScmInstallationModel.listByScope(ctx.serverDB, ctx.scope),
  ),

  /**
   * Repositories the scope's live GitHub installations can read, most recently
   * pushed first — the list "new project from GitHub" picks from. Read through
   * the installations rather than the user's own token, so it shows exactly
   * what an environment built from the pick can clone. One installation
   * failing (rate limit, revoked on GitHub before the webhook lands) leaves the
   * others listed; only when every one fails is that an error.
   */
  listRepositories: scmProcedure.query(async ({ ctx }) => {
    try {
      return await listScopeGitHubRepositories(ctx.serverDB, ctx.scope);
    } catch (error) {
      if (!(error instanceof ScmRepositoriesUnavailableError)) throw error;

      throw new TRPCError({ cause: error.cause, code: 'BAD_GATEWAY', message: error.message });
    }
  }),
});

export type ScmRouter = typeof scmRouter;
