import { TRPCError } from '@trpc/server';

import { type WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import type { DeviceModel } from '@/database/models/device';

import { canOperateWorkspaceDevice } from '../deviceWorkspaceGuard';

/**
 * A workspace device's user-editable fields (rename, working dirs, remove) may
 * be modified by:
 *   1. any workspace owner — managing shared infra is an owner privilege, OR
 *   2. the workspace member who originally enrolled the device (`devices.userId`
 *      stores the first enroller for workspace rows, never overwritten on
 *      re-enroll — see `DeviceModel.registerWorkspaceDevice`).
 *
 * Members can therefore self-serve their own machines without touching anyone
 * else's enrollment, while shared cleanup remains an owner action.
 */
/**
 * Gate an action that operates the machine itself — browsing folders, a
 * terminal, exposing a port, updating its app. A public workspace device is
 * shared infra every member works on, so any member may operate it; a private
 * one stays limited to the enrolling member or a workspace owner.
 */
export const assertDeviceOperable = async (
  ctx: {
    deviceModel: DeviceModel;
    userId: string;
    workspaceId?: string;
    workspaceRole?: WorkspaceRole;
  },
  deviceId: string,
  action: string,
) => {
  if (!ctx.workspaceId) return;

  const row = await ctx.deviceModel.findWorkspaceDeviceById(deviceId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
  if (!canOperateWorkspaceDevice(ctx.workspaceRole, ctx.userId, row)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        row.visibility === 'public'
          ? `Workspace viewers cannot ${action} on this device.`
          : `Only the enrolling member or a workspace owner can ${action} on this private device.`,
    });
  }
};
