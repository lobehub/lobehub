import { TRPCError } from '@trpc/server';

import { enableBetterAuth, enableNextAuth } from '@/envs/auth';

import { trpc } from '../lambda/init';

export const userAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  // `ctx.user` is nullable
  if (!ctx.userId) {
    if (enableBetterAuth) {
      console.log('better auth: no session found in context');
    } else if (enableNextAuth) {
      console.log('next auth:', ctx.nextAuth);
    }
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return opts.next({
    // ✅ user value is known to be non-null now
    ctx: { userId: ctx.userId },
  });
});
