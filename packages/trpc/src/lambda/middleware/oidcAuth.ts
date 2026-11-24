import { HETERO_CALLER_SCOPES } from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';

import type { HeteroOperationJwtClaims } from '../../utils/internalJwt';
import { validateHeteroOperationClaims } from '../../utils/internalJwt';
import { trpc } from '../init';
import {
  authorizeHeteroOperationEvidence,
  HETERO_OPERATION_ROUTE_CAPABILITIES,
} from './heteroOperationEvidence';

/**
 * Let a device run's `caller:act` token act as its `sub`, or throw.
 *
 * The run's scope and lifetime are re-checked on every request (see
 * `authorizeHeteroCallerToken`), and its refusals carry their own messages.
 */
const authorizeHeteroCaller = async (
  claims: HeteroOperationJwtClaims,
  workspaceId?: string | null,
) => {
  // Loaded only when a caller token arrives, for the same reason as the
  // evidence authorizer: `oidcAuth` sits in front of every authed router.
  const [{ getServerDB }, { authorizeHeteroCallerToken, HeteroCallerTokenError }] =
    await Promise.all([
      import('@/database/core/db-adaptor'),
      import('@/server/services/heterogeneousAgent/callerToken'),
    ]);

  try {
    const principal = await authorizeHeteroCallerToken({
      claims,
      db: await getServerDB(),
      requestedWorkspaceId: workspaceId,
    });
    return principal.userId;
  } catch (error) {
    if (!(error instanceof HeteroCallerTokenError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
      message: error.message,
    });
  }
};

/**
 * Should this request stay on the run's own operation route instead of
 * acting as the caller?
 *
 * `verify.*` always does: a token without the round's `acceptance:evidence` is
 * refused there, never let through as the user, which would drop the
 * own-round and evidence-only checks and reach the user's other rounds.
 * `file.createFile` into a library destination (a knowledge base or a folder)
 * is ordinary user work and acts as the caller under `file:write`; any other
 * upload stays a private acceptance or tool-result attachment.
 * `user.getUserState` is an ordinary user read too, so only a token holding
 * the evidence capability gets the bound, language-only answer.
 */
const staysOnOperationRoute = (
  path: string,
  capabilities: readonly string[],
  input: unknown,
): boolean => {
  const accepted = HETERO_OPERATION_ROUTE_CAPABILITIES.get(path);
  if (!accepted) return false;
  if (path === 'file.createFile') {
    const { knowledgeBaseId, parentId } = (input ?? {}) as Record<string, unknown>;
    return ![knowledgeBaseId, parentId].some((id) => typeof id === 'string' && id.length > 0);
  }
  if (path === 'user.getUserState') return accepted.some((item) => capabilities.includes(item));
  return true;
};

export const oidcAuth = trpc.middleware(async (opts) => {
  const { ctx, getRawInput, next, path } = opts;

  // Check OIDC authentication
  if (ctx.oidcAuth) {
    // hetero-operation tokens are long-lived (4h). A device run's token with
    // `caller:act` acts as the user who started the run, in the run's workspace,
    // while the run lasts, limited to HETERO_CALLER_SCOPES like a restricted API
    // key (`apiKeyScopeGuard`, `assertReachableByCaller`). Any other operation token is scoped to heteroIngest /
    // heteroFinish and the run's own routes in HETERO_OPERATION_ROUTE_CAPABILITIES
    // (acceptance evidence, tool-result file store), and is rejected on every
    // other route so a leaked sandbox JWT cannot be replayed against it.
    if (ctx.oidcAuth.purpose === 'hetero-operation') {
      const claims = validateHeteroOperationClaims(ctx.oidcAuth as Record<string, unknown>);
      const actsAsCaller = !!claims?.capabilities.includes('caller:act');

      if (
        !claims ||
        !actsAsCaller ||
        staysOnOperationRoute(path, claims.capabilities, await getRawInput())
      ) {
        const scope = await authorizeHeteroOperationEvidence({
          oidcAuth: ctx.oidcAuth,
          path,
          workspaceId: ctx.workspaceId,
        });

        return next({ ctx: { ...scope, oidcAuth: ctx.oidcAuth } });
      }

      const userId = await authorizeHeteroCaller(claims, ctx.workspaceId);
      return next({
        ctx: { apiKeyScopes: [...HETERO_CALLER_SCOPES], oidcAuth: ctx.oidcAuth, userId },
      });
    }

    return next({
      ctx: { oidcAuth: ctx.oidcAuth, userId: ctx.oidcAuth.sub },
    });
  }

  return next();
});
