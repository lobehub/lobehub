import type { DeviceMetricSeries, DeviceScope } from '@lobechat/types';
import {
  bucketDeviceMetrics,
  DEVICE_METRIC_RETENTION_MS,
  DEVICE_METRIC_SAMPLE_INTERVAL_MS,
  DEVICE_METRIC_VIEW_WINDOW_MS,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel } from '@/database/models/device';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { deviceGateway } from '@/server/services/deviceGateway';

/** Aim for about this many points per chart, whatever the window. */
const TARGET_POINTS = 144;

const deviceMetricProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  const deviceModel = new DeviceModel(ctx.serverDB, ctx.userId, workspaceId);

  /**
   * Gate a client-supplied `deviceId` with the same visibility rule every
   * device route uses: in a workspace the rows the caller can see (public, or
   * its own private enrollment) plus the caller's own personal devices, which
   * `listDevices` surfaces there too; otherwise only the caller's personal
   * rows. The gateway itself only knows principals, not visibility.
   *
   * Returns the workspace principal the device's metrics live under —
   * `undefined` for a personal device, which reports under the user principal
   * even when it is read from a workspace. A personal and a workspace row can
   * share a deviceId (an explicit `--device-id` on both connections), so the
   * list item's `scope` picks the row; without it the workspace row wins.
   */
  const resolveDevicePrincipal = async (
    deviceId: string,
    scope?: DeviceScope,
  ): Promise<string | undefined> => {
    if (
      workspaceId &&
      scope !== 'personal' &&
      (await deviceModel.findWorkspaceDeviceById(deviceId))
    )
      return workspaceId;

    if (scope === 'workspace' || !(await deviceModel.findPersonalByDeviceId(deviceId))) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found.' });
    }
    return undefined;
  };

  return opts.next({ ctx: { resolveDevicePrincipal, userId: ctx.userId } });
});

export const deviceMetricRouter = router({
  /**
   * The machine's recent CPU / memory / load, read from the device gateway
   * (the only store — it keeps two days) and averaged into buckets sized so
   * the window renders as roughly {@link TARGET_POINTS} points.
   */
  getSeries: deviceMetricProcedure
    .input(
      z.object({
        deviceId: z.string().min(1).max(64),
        /** The list item's scope; disambiguates a deviceId shared by both scopes. */
        scope: z.enum(['personal', 'workspace']).optional(),
        windowMs: z
          .number()
          .int()
          .min(DEVICE_METRIC_SAMPLE_INTERVAL_MS)
          .max(DEVICE_METRIC_RETENTION_MS)
          .default(DEVICE_METRIC_VIEW_WINDOW_MS),
      }),
    )
    .query(async ({ ctx, input }): Promise<DeviceMetricSeries> => {
      const workspaceId = await ctx.resolveDevicePrincipal(input.deviceId, input.scope);
      const to = Date.now();
      const from = to - input.windowMs;
      const bucketMs = Math.max(
        DEVICE_METRIC_SAMPLE_INTERVAL_MS,
        Math.ceil(input.windowMs / TARGET_POINTS / DEVICE_METRIC_SAMPLE_INTERVAL_MS) *
          DEVICE_METRIC_SAMPLE_INTERVAL_MS,
      );

      const samples = await deviceGateway.queryDeviceMetrics({
        deviceId: input.deviceId,
        since: from,
        userId: ctx.userId,
        workspaceId,
      });
      const latest = samples.at(-1);

      return {
        bucketMs,
        cpuCount: latest?.cpuCount ?? null,
        from,
        memoryTotalBytes: latest?.memoryTotalBytes ?? null,
        points: bucketDeviceMetrics(samples, { bucketMs, from, to }),
        to,
      };
    }),
});
