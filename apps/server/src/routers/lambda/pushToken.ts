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
   * Public on purpose: clients call this during sign-out, and in the wild many
   * of those calls arrive after the session is already gone (expired OIDC
   * token / cleared cookie). Authenticating by session here causes a 401
   * storm on every such logout.
   *
   * Authorization model (Path A — new clients ≥ 1.0.8): the caller presents the
   * (deviceId, expoToken) pair it received at registration. Holding both = proof
   * of ownership of the row, same trust model as APNs/FCM unregister.
   *
   * Backwards compat for v1.0.7 (only sends `deviceId`):
   *  - Path B — when the request still carries a valid session, fall back to
   *    the original (userId, deviceId) delete. This covers the *active*
   *    sign-out path so PushChannel doesn't keep notifying a signed-out device
   *    until the user uninstalls (Expo's DeviceNotRegistered receipt only
   *    fires on uninstall, not on logout).
   *  - Path C — when there's no session either, silently succeed. The orphan
   *    row will be cleaned up by the existing `process-push-receipts` worker
   *    via Expo's DeviceNotRegistered receipts. Returning 200 here is what
   *    actually stops the 401 storm in production.
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

      // Path A: new clients — precise delete by (expoToken, deviceId), no session needed
      if (expoToken) {
        await deletePushTokenByExpoTokenAndDevice(ctx.serverDB, { deviceId, expoToken });
        return { success: true };
      }

      // Path B: legacy v1.0.7 + valid session — fall back to (userId, deviceId)
      if (ctx.userId) {
        const pushTokenModel = new PushTokenModel(ctx.serverDB, ctx.userId);
        await pushTokenModel.unregister(deviceId);
        return { success: true };
      }

      // Path C: legacy v1.0.7 with no session — silent OK, cron worker cleans up
      return { success: true };
    }),
});

export type PushTokenRouter = typeof pushTokenRouter;
