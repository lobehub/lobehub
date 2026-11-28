import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { deviceGateway } from '@/server/services/deviceGateway';

import { assertDeviceOperable } from './guards';
import { deviceProcedure } from './procedures';

export const operateRouter = router({
  getAppUpdateState: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // alint-expect
      await assertDeviceOperable(ctx, input.deviceId, 'update the app');
      return deviceGateway.getUpdateState(input.deviceId);
    }),
  installAppUpdate: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'update the app');
      return deviceGateway.installUpdate(input.deviceId);
    }),
  restartAgent: deviceProcedure
    .input(z.object({ deviceId: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'restart the agent');
      return deviceGateway.restart(input.deviceId, { force: input.force });
    }),
});
