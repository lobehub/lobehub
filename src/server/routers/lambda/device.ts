import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { deviceProxy } from '@/server/services/toolExecution/deviceProxy';

const deviceProcedure = authedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { userId: ctx.userId },
  });
});

export const deviceRouter = router({
  getDeviceSystemInfo: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      return deviceProxy.queryDeviceSystemInfo(ctx.userId, input.deviceId);
    }),

  listDevices: deviceProcedure.query(async ({ ctx }) => {
    return deviceProxy.queryDeviceList(ctx.userId);
  }),

  status: deviceProcedure.query(async ({ ctx }) => {
    return deviceProxy.queryDeviceStatus(ctx.userId);
  }),
});
