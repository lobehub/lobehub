import { TRPCError } from '@trpc/server';

import { trpc } from '../lambda/init';

export const platformAdminAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  if (!ctx.adminId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return opts.next({
    ctx: { adminId: ctx.adminId },
  });
});
