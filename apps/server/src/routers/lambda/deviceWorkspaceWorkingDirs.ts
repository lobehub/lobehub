import { workingDirConfigSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  type WorkspaceRole,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel } from '@/database/models/device';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { upsertWorkingDir } from './deviceWorkingDirs';
import { canOperateWorkspaceDevice } from './deviceWorkspaceGuard';

/**
 * Add or remove ONE recent working directory on a workspace device. Picking,
 * adding and removing a folder is part of using a device, so any member who may
 * operate it (every non-viewer on a public device) may do this. Each call edits
 * the stored list under a row lock instead of replacing it with the caller's
 * snapshot, so concurrent members cannot drop each other's entries.
 */
const workingDirProcedure = wsProcedure
  .use(requireWorkspaceRole('member'))
  .use(serverDatabase)
  .use(async (opts) => {
    const { ctx } = opts;
    const { deviceId } = z.object({ deviceId: z.string() }).parse(await opts.getRawInput());
    const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const row = await model.findWorkspaceDeviceById(deviceId);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });

    const role = (ctx as { workspaceRole?: WorkspaceRole }).workspaceRole;
    if (!canOperateWorkspaceDevice(role, ctx.userId, row)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You cannot change the working directories of this device.',
      });
    }
    return opts.next({ ctx: { workspaceDeviceModel: model } });
  });

export const workspaceDeviceWorkingDirProcedures = {
  addWorkspaceDeviceWorkingDir: workingDirProcedure
    .input(z.object({ deviceId: z.string(), entry: workingDirConfigSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.workspaceDeviceModel.mutateWorkspaceDeviceWorkingDirs(input.deviceId, (dirs) =>
        upsertWorkingDir(input.entry, dirs),
      );
      return { success: true };
    }),

  removeWorkspaceDeviceWorkingDir: workingDirProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.workspaceDeviceModel.mutateWorkspaceDeviceWorkingDirs(input.deviceId, (dirs) =>
        dirs.filter((dir) => dir.path !== input.path),
      );
      return { success: true };
    }),
};
