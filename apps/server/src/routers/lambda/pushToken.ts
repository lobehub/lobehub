import { z } from 'zod';

import { PushTokenModel } from '@/database/models/pushToken';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const pushTokenProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { pushTokenModel: new PushTokenModel(ctx.serverDB, ctx.userId) },
  });
});

export const pushTokenRouter = router({
  register: pushTokenProcedure
    .input(
      z.object({
        appVersion: z.string().optional(),
        deviceId: z.string().min(1),
        expoToken: z.string().min(1),
        locale: z.string().optional(),
        platform: z.enum(['ios', 'android']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.pushTokenModel.upsert(input);
    }),

  unregister: pushTokenProcedure
    .input(z.object({ deviceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.pushTokenModel.unregister(input.deviceId);
    }),
});

export type PushTokenRouter = typeof pushTokenRouter;
