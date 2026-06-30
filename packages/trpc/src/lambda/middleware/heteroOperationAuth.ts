import { TRPCError } from '@trpc/server';

import { trpc } from '../init';

/**
 * Auth middleware for hetero-agent ingest/finish endpoints. Accepts two callers:
 *
 * - A `hetero-operation` token (4h expiry) — the narrow, server-minted JWT
 *   issued by execAgent for the cloud sandbox / workspace device. Its `sub` may
 *   be a userId or, for workspace runs, a workspaceId. Behaves exactly as before.
 * - A normal user OIDC token — a logged-in desktop reusing its own session for a
 *   remote run dispatched to it, so the spawned `lh hetero exec` can stream
 *   results back without a server round-trip to mint a dedicated token.
 *
 * The owner-token path is safe because heteroIngest / heteroFinish additionally
 * gate every write on `topics.userId === ctx.userId` (see the `heteroAuthKind`
 * ownership check in the handlers), so an owner token can only touch its own
 * running operation — it cannot reach another user's topic.
 *
 * `heteroAuthKind` is forwarded so handlers can apply the strict ownership guard
 * to owner tokens only, while leaving the operation-token path (whose `sub` may
 * be a workspaceId that never matches `topics.userId`) untouched.
 */
export const heteroOperationAuth = trpc.middleware(async (opts) => {
  const { ctx, next } = opts;

  const sub = ctx.oidcAuth?.sub as string | undefined;
  if (!ctx.oidcAuth || !sub) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'This endpoint requires an authenticated token',
    });
  }

  const heteroAuthKind = ctx.oidcAuth.purpose === 'hetero-operation' ? 'operation' : 'user';

  return next({
    ctx: { heteroAuthKind, oidcAuth: ctx.oidcAuth, userId: sub },
  });
});
