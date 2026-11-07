import { TRPCError } from '@trpc/server';

import { validateHeteroOperationClaims } from '../../utils/internalJwt';
import { trpc } from '../init';

const STRICT_OPERATION_CLAIMS = ['aud', 'capabilities', 'iss', 'jti', 'operation_id'] as const;

/**
 * Auth middleware for hetero-agent ingest/finish endpoints. Accepts two callers:
 *
 * - A `hetero-operation` token (4h expiry) — the narrow, server-minted JWT
 *   issued by execAgent for the cloud sandbox / workspace device. Its `sub` is
 *   the user principal and workspace runs carry a separate `workspace_id` claim.
 * - A legacy `hetero-operation` token minted before operation-bound claims were
 *   deployed — accepted temporarily so an already-running job can finish.
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

  const isOperation = ctx.oidcAuth.purpose === 'hetero-operation';
  const heteroOperation = isOperation
    ? validateHeteroOperationClaims(ctx.oidcAuth as Record<string, unknown>)
    : undefined;
  // A partially populated strict contract must not fall back to the broader
  // ownership path. Only the purpose/sub-only shape issued by old pods qualifies.
  const isLegacyOperation =
    isOperation && STRICT_OPERATION_CLAIMS.every((claim) => ctx.oidcAuth?.[claim] === undefined);
  if (isOperation && !heteroOperation && !isLegacyOperation) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid heterogeneous operation token' });
  }
  const heteroAuthKind = heteroOperation
    ? 'operation'
    : isLegacyOperation
      ? 'legacy-operation'
      : 'user';

  return next({
    ctx: { heteroAuthKind, heteroOperation, oidcAuth: ctx.oidcAuth, userId: sub },
  });
});
