import { z } from 'zod';

import {
  deletePushTokenByExpoTokenAndDevice,
  PushTokenModel,
} from '@/database/models/pushToken';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const authedPushTokenProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { pushTokenModel: new PushTokenModel(ctx.serverDB, ctx.userId) },
  });
});

export const pushTokenRouter = router({
  register: authedPushTokenProcedure
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

  /**
   * Public on purpose: clients call this during sign-out, when their session
   * may already be invalid (expired token / cleared cookie). Authenticating by
   * session here causes a 401 storm on every logout in the wild — the original
   * intent was "clean up before clearing auth", but in practice the auth has
   * already been cleared on the server long before logout fires.
   *
   * Authorization model: the caller presents the (deviceId, expoToken) pair it
   * received at registration. Holding both = proof of ownership of the row,
   * same trust model as APNs/FCM unregister.
   *
   * Backwards compat: older clients (≤ 1.0.7) only send `deviceId`. We silently
   * succeed in that case and let the `process-push-receipts` worker clean up
   * stale rows via `DeviceNotRegistered` receipts from Expo. Returning 200 here
   * is what actually stops the 401 storm in production.
   */
  unregister: publicProcedure
    .use(serverDatabase)
    .input(
      z.object({
        deviceId: z.string().min(1),
        expoToken: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { deviceId, expoToken } = input;

      if (expoToken) {
        await deletePushTokenByExpoTokenAndDevice(ctx.serverDB, { deviceId, expoToken });
      }

      return { success: true };
    }),
});

export type PushTokenRouter = typeof pushTokenRouter;
