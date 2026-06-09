import { TRPCError } from '@trpc/server';

import { trpc } from '../init';

/**
 * Auth middleware for hetero-agent ingest/finish endpoints.
 * Accepts ONLY tokens signed with `purpose: 'hetero-operation'` (4h expiry).
 * All other tokens — including normal user OIDC tokens — are rejected,
 * so this procedure cannot be called from the browser or CLI without the
 * dedicated operation JWT issued by execAgent.
 */
export const heteroOperationAuth = trpc.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.oidcAuth || ctx.oidcAuth.purpose !== 'hetero-operation') {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'This endpoint requires a hetero-operation token',
    });
  }

  return next({
    ctx: { oidcAuth: ctx.oidcAuth, userId: ctx.oidcAuth.sub as string },
  });
});
