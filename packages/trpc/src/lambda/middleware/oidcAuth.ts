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
 * `authorizeHeteroCallerToken`). Its refusals carry their own messages, never
 * the operation-token refusal, so the CLI's same-account fallback
 * (`operationTokenFallback`) cannot step outside the run's workspace or past its
 * end with the machine's login.
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

export const oidcAuth = trpc.middleware(async (opts) => {
  const { ctx, next, path } = opts;

  // Check OIDC authentication
  if (ctx.oidcAuth) {
    // hetero-operation tokens are long-lived (4h). A device run's token with
    // `caller:act` acts as the user who started the run, in the run's workspace,
    // while the run lasts. Any other operation token is scoped to heteroIngest /
    // heteroFinish and the run's own routes in HETERO_OPERATION_ROUTE_CAPABILITIES
    // (acceptance evidence, tool-result file store), and is rejected on every
    // other route so a leaked sandbox JWT cannot be replayed against it.
    if (ctx.oidcAuth.purpose === 'hetero-operation') {
      const claims = validateHeteroOperationClaims(ctx.oidcAuth as Record<string, unknown>);
      const actsAsCaller = !!claims?.capabilities.includes('caller:act');
      // A run's own operation routes (evidence, tool-result file store) keep
      // their binding to the run when the token holds the capability they need.
      const operationRoute = !!HETERO_OPERATION_ROUTE_CAPABILITIES.get(path)?.some((capability) =>
        claims?.capabilities.includes(capability),
      );

      if (!claims || !actsAsCaller || operationRoute) {
        const scope = await authorizeHeteroOperationEvidence({
          oidcAuth: ctx.oidcAuth,
          path,
          workspaceId: ctx.workspaceId,
        });

        return next({ ctx: { ...scope, oidcAuth: ctx.oidcAuth } });
      }

      const userId = await authorizeHeteroCaller(claims, ctx.workspaceId);
      return next({ ctx: { oidcAuth: ctx.oidcAuth, userId } });
    }

    return next({
      ctx: { oidcAuth: ctx.oidcAuth, userId: ctx.oidcAuth.sub },
    });
  }

  return next();
});
