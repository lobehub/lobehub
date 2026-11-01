import { z } from 'zod';

import {
  registerAgentInterventionLiveActivity,
  registerLiveActivityPushToStartToken,
} from '@/business/server/notification/liveActivity';
import {
  deletePushTokenByExpoTokenAndDevice,
  PushLiveActivityModel,
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
        apnsEnvironment: z.enum(['sandbox', 'production']).optional(),
        appVersion: z.string().optional(),
        deviceId: z.string().min(1),
        expoToken: z.string().min(1),
        liveActivityPushToStartToken: z.string().min(1).max(512).optional(),
        locale: z.string().optional(),
        platform: z.enum(['ios', 'android']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { apnsEnvironment, liveActivityPushToStartToken, ...pushToken } = input;
      const row = await ctx.pushTokenModel.upsert(pushToken);

      if (apnsEnvironment && liveActivityPushToStartToken) {
        await registerLiveActivityPushToStartToken({
          apnsEnvironment,
          deviceId: input.deviceId,
          liveActivityPushToStartToken,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
      }

      return row;
    }),

  /** Register/rotate one ActivityKit update token by durable intervention id. */
  registerLiveActivity: authedPushTokenProcedure
    .input(
      z.object({
        activityId: z.string().min(1).max(200),
        activityKey: z.string().min(1).max(200),
        apnsEnvironment: z.enum(['sandbox', 'production']),
        deviceId: z.string().min(1),
        operationId: z.string().min(1),
        pushToken: z.string().min(1).max(512),
      }),
    )
    .mutation(({ ctx, input }) =>
      registerAgentInterventionLiveActivity({
        ...input,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      }),
    ),

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
        const liveActivityModel = new PushLiveActivityModel(ctx.serverDB, ctx.userId);
        await Promise.all([
          pushTokenModel.unregister(deviceId),
          liveActivityModel.unregisterDevice(deviceId),
        ]);
        return { success: true };
      }

      // Path C: legacy v1.0.7 with no session — silent OK, cron worker cleans up
      return { success: true };
    }),
});

export type PushTokenRouter = typeof pushTokenRouter;
