import { TRPCError } from '@trpc/server';

import { trpc } from '../lambda/init';

export const userAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  // `ctx.user` is nullable
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return opts.next({
    // ✅ user value is known to be non-null now
    ctx: { userId: ctx.userId },
  });
});
