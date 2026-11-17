import type { ScmCredentialGrantFailure, ScmCredentialGrantPath } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ScmCredentialGrantModel } from '@/database/models/scm';
import { hasActiveWorkspaceMembership, WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { GithubUserTokenService } from '@/server/services/scm/github/userToken';

import { GITHUB_AUTHORIZE_PATH } from './scm';

const GITHUB_HOST = 'github.com';
const SETTINGS_RETURN_PATH = '/settings/integrations/github';
const GIT_USERNAME = 'x-access-token';

const FAILURE_MESSAGES: Record<ScmCredentialGrantFailure, string> = {
  no_requester: "This run has no member behind it, so it cannot push with anyone's GitHub account.",
  not_authorized: 'Connect your GitHub account to LobeHub to push from a shared device.',
  operation_ended: 'This run has ended; its GitHub credential is no longer available.',
  policy_disabled: 'This workspace does not issue member GitHub credentials on shared devices.',
  reauthorize: 'Your GitHub authorization expired. Connect your GitHub account again.',
  requester_not_member: 'The member who started this run is no longer in the workspace.',
  unavailable: 'GitHub could not be reached to issue a credential. Try again shortly.',
};

const authorizeUrl = () => {
  const url = new URL(GITHUB_AUTHORIZE_PATH, appEnv.APP_URL);
  url.searchParams.set('returnTo', SETTINGS_RETURN_PATH);
  return url.toString();
};

const normalizeRepo = (path?: string) => {
  const repo = path?.replace(/^\/+/, '').replace(/\.git$/, '');
  return repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : undefined;
};

const grantPath = (claims: HeteroOperationJwtClaims): ScmCredentialGrantPath =>
  claims.capabilities.includes('hetero:ingest') ? 'hetero' : 'tool-call';

const fail = async (
  db: LobeChatDatabase,
  reason: ScmCredentialGrantFailure,
  audit: { claims: HeteroOperationJwtClaims; repo?: string; workspaceId?: string },
) => {
  if (audit.workspaceId && audit.claims.requester) {
    await ScmCredentialGrantModel.create(db, {
      deviceId: audit.claims.device_id,
      operationId: audit.claims.operation_id,
      path: grantPath(audit.claims),
      repo: audit.repo,
      requesterUserId: audit.claims.requester,
      result: reason,
      workspaceId: audit.workspaceId,
    });
  }

  return {
    ...(reason === 'not_authorized' || reason === 'reauthorize'
      ? { authorizeUrl: authorizeUrl() }
      : {}),
    message: FAILURE_MESSAGES[reason],
    ok: false as const,
    reason,
  };
};

export const scmCredentialRouter = router({
  github: heteroAuthedProcedure
    .use(serverDatabase)
    .input(
      z.object({
        host: z.string(),
        path: z.string().optional(),
        protocol: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: "GitHub credentials are issued to a run's operation token only",
        });
      }
      if (input.host.toLowerCase() !== GITHUB_HOST) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `No credentials for ${input.host}` });
      }

      const claims = ctx.heteroOperation;
      const db = ctx.serverDB;
      const repo = normalizeRepo(input.path);
      const audit = { claims, repo, workspaceId: claims.workspace_id };

      let workspaceId: string | undefined;
      try {
        const principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'scm:github-credential',
          claims,
          db,
          operationId: claims.operation_id,
        });
        workspaceId = principal.workspaceId;
      } catch (error) {
        if (!(error instanceof HeteroOperationPrincipalError)) throw error;
        if (error.status === 409) return fail(db, 'operation_ended', audit);
        throw new TRPCError({
          cause: error,
          code: error.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: error.message,
        });
      }

      const requester = claims.requester;
      if (!requester) return fail(db, 'no_requester', audit);
      if (!workspaceId) return fail(db, 'policy_disabled', audit);

      const enabled = await new WorkspaceModel(db, requester).getScmRequesterCredential(
        workspaceId,
      );
      if (!enabled) return fail(db, 'policy_disabled', { ...audit, workspaceId });

      if (!(await hasActiveWorkspaceMembership(db, { userId: requester, workspaceId }))) {
        return fail(db, 'requester_not_member', { ...audit, workspaceId });
      }

      const token = await new GithubUserTokenService(db).getFreshToken(requester);
      if (!token.ok) return fail(db, token.reason, { ...audit, workspaceId });

      await ScmCredentialGrantModel.create(db, {
        deviceId: claims.device_id,
        operationId: claims.operation_id,
        path: grantPath(claims),
        repo,
        requesterUserId: requester,
        result: 'issued',
        tokenExpiresAt: token.expiresAt,
        workspaceId,
      });

      return {
        expiresAt: token.expiresAt.toISOString(),
        gitEmail: token.gitEmail,
        gitName: token.gitName,
        ok: true as const,
        password: token.token,
        username: GIT_USERNAME,
      };
    }),
});
