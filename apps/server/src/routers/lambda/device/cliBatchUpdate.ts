import type { DeviceCliBatchEntry } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import type { DeviceModel } from '@/database/models/device';
import { router } from '@/libs/trpc/lambda';
import { deviceGateway } from '@/server/services/deviceGateway';
import {
  checkCliDevices,
  type CliBatchDevice,
  type CliBatchRelay,
  isCliChannel,
  updateCliDevices,
} from '@/server/services/deviceGateway/cliBatchUpdate';
import { filterAuthorizedDevicePresence } from '@/server/services/deviceGateway/scopedDevicePresence';

import { canOperateWorkspaceDevice } from '../deviceWorkspaceGuard';
import { deviceProcedure } from './procedures';

const log = debug('lobe-server:device-gateway');

/** Bounds one update request; a workspace pool is far smaller. */
const MAX_BATCH_DEVICES = 200;

interface CliBatchContext {
  deviceModel: DeviceModel;
  userId: string;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
}

const requireWorkspace = (ctx: CliBatchContext): string => {
  if (ctx.workspaceId) return ctx.workspaceId;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Batch CLI updates are only available in a workspace.',
  });
};

/**
 * The workspace's CLI devices the caller may operate, keyed by deviceId: the
 * same `canOperateWorkspaceDevice` gate a single-device update passes. A device
 * counts once it has reported a CLI version or holds a live `lh connect`.
 */
const loadCliDevices = async (ctx: CliBatchContext, workspaceId: string) => {
  const [rows, presence] = await Promise.all([
    ctx.deviceModel.queryWorkspaceDevices(),
    deviceGateway.queryDeviceList(ctx.userId, workspaceId),
  ]);
  const operable = rows.filter((row) =>
    canOperateWorkspaceDevice(ctx.workspaceRole, ctx.userId, row),
  );
  const live = new Set(
    filterAuthorizedDevicePresence(
      new Set(operable.map((row) => row.deviceId)),
      presence,
      'workspace',
    )
      .filter((device) => device.channels?.some((c) => isCliChannel(c.channel)))
      .map((device) => device.deviceId),
  );
  const devices = new Map<string, CliBatchDevice & { visibility: 'private' | 'public' }>();
  for (const row of operable) {
    if (!live.has(row.deviceId) && !row.metadata?.cliVersion) continue;
    devices.set(row.deviceId, {
      deviceId: row.deviceId,
      live: live.has(row.deviceId),
      visibility: row.visibility,
    });
  }
  return devices;
};

const createRelay = (ctx: CliBatchContext, workspaceId: string): CliBatchRelay => ({
  check: (deviceId) => deviceGateway.checkCliUpdate({ deviceId, userId: ctx.userId, workspaceId }),
  restart: ({ deviceId, requestId }) =>
    deviceGateway.restartCli({
      deviceId,
      requestId,
      update: true,
      userId: ctx.userId,
      workspaceId,
    }),
});

export const cliBatchUpdateRouter = router({
  /**
   * Plan a batch CLI update for one visibility tab of the workspace pool: check
   * every operable CLI device and report what an update would do. Nothing
   * restarts.
   */
  checkCliUpdates: deviceProcedure
    .input(z.object({ visibility: z.enum(['private', 'public']) }).strict())
    .mutation(async ({ ctx, input }): Promise<DeviceCliBatchEntry[]> => {
      const workspaceId = requireWorkspace(ctx);
      const devices = [...(await loadCliDevices(ctx, workspaceId)).values()].filter(
        (device) => device.visibility === input.visibility,
      );
      return checkCliDevices(devices, createRelay(ctx, workspaceId));
    }),

  /**
   * Update the CLI on the planned devices. Each target is checked again and
   * restarted only if it is still idle and behind; a device the caller can no
   * longer operate fails without any RPC reaching it.
   */
  updateClis: deviceProcedure
    .input(
      z
        .object({
          targets: z
            .array(z.object({ deviceId: z.string(), requestId: z.string().uuid() }).strict())
            .min(1)
            .max(MAX_BATCH_DEVICES)
            .refine((targets) => new Set(targets.map((t) => t.deviceId)).size === targets.length, {
              message: 'Each device can only be updated once per request.',
            }),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }): Promise<DeviceCliBatchEntry[]> => {
      const workspaceId = requireWorkspace(ctx);
      const devices = await loadCliDevices(ctx, workspaceId);
      const allowed = input.targets.flatMap((target) => {
        const device = devices.get(target.deviceId);
        return device ? [{ ...target, live: device.live }] : [];
      });
      const updated = new Map(
        (await updateCliDevices(allowed, createRelay(ctx, workspaceId))).map((entry) => [
          entry.deviceId,
          entry,
        ]),
      );
      const entries = input.targets.map(
        ({ deviceId }): DeviceCliBatchEntry =>
          updated.get(deviceId) ?? {
            deviceId,
            message: 'This device is no longer available for you to update.',
            outcome: 'failed',
          },
      );
      // One call can restart a whole pool: record who asked and what happened.
      const outcomes: Record<string, number> = {};
      for (const { outcome } of entries) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      log('updateClis: userId=%s workspaceId=%s outcomes=%o', ctx.userId, workspaceId, outcomes);
      return entries;
    }),
});
