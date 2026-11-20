import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel } from '@/database/models/device';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertWorkspaceDeviceVisible } from '../deviceWorkspaceGuard';

// Workspace-aware (compat): with an `X-Workspace-Id` header the device list also
// surfaces the workspace's shared devices; without it, the personal path is
// unchanged (`ctx.workspaceId === undefined`).
//
// Every route below that takes a `deviceId` input also passes the workspace
// visibility gate — see `assertWorkspaceDeviceVisible` for why filtering the
// list paths alone is not enough.
export const deviceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  const deviceModel = new DeviceModel(ctx.serverDB, ctx.userId, wsId);

  if (wsId) {
    const raw = (await opts.getRawInput()) as { deviceId?: unknown } | undefined;
    if (typeof raw?.deviceId === 'string') {
      await assertWorkspaceDeviceVisible(deviceModel, raw.deviceId);
    }
  }

  return opts.next({
    ctx: {
      deviceModel,
      userId: ctx.userId,
      workspaceId: wsId,
    },
  });
});
