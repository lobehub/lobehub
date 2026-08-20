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
 * The handlers resolve the target topic and require this subject to own its
 * personal scope or be an active member of its workspace before writing.
 * `heteroAuthKind` remains available to endpoints that need to distinguish the
 * narrow operation token from a full user session.
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
