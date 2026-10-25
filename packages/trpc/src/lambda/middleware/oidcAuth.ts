import { trpc } from '../init';
import { authorizeHeteroOperationEvidence } from './heteroOperationEvidence';

export const oidcAuth = trpc.middleware(async (opts) => {
  const { ctx, next, path } = opts;

  // Check OIDC authentication
  if (ctx.oidcAuth) {
    // hetero-operation tokens are long-lived (4h) and scoped to heteroIngest /
    // heteroFinish, plus a Task run's own acceptance evidence. Reject them on
    // every other route so a leaked sandbox JWT cannot be replayed against it.
    if (ctx.oidcAuth.purpose === 'hetero-operation') {
      const scope = await authorizeHeteroOperationEvidence({
        oidcAuth: ctx.oidcAuth,
        path,
        workspaceId: ctx.workspaceId,
      });

      return next({ ctx: { ...scope, oidcAuth: ctx.oidcAuth } });
    }

    return next({
      ctx: { oidcAuth: ctx.oidcAuth, userId: ctx.oidcAuth.sub },
    });
  }

  return next();
});
