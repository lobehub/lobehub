import { isManagedCloudDevice } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  type DeviceModel,
  ManagedDeviceRegistrationConflictError,
  WorkspaceDevicePrivateConflictError,
} from '@/database/models/device';

import { canOperateWorkspaceDevice } from '../deviceWorkspaceGuard';

/**
 * Identity sources a client may claim for itself. The managed cloud device
 * source is written only by the server that creates such a device.
 */
export const clientIdentitySourceSchema = z.enum(['machine-id', 'fallback']);

/** Check an identity source a device reported over RPC (share flow). */
export const parseReportedIdentitySource = (value: unknown) => {
  const parsed = clientIdentitySourceSchema.safeParse(value);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Device reported an identity source it may not claim.',
    });
  }
  return parsed.data;
};

/**
 * Refuse a client action on a managed cloud device's row with CONFLICT. The
 * platform owns that row, so a client cannot share or overwrite it.
 */
export const assertNotManagedDevice = (
  device: { identitySource: string | null },
  message: string,
) => {
  if (isManagedCloudDevice(device)) throw new TRPCError({ code: 'CONFLICT', message });
};

/**
 * The tRPC error for a failed device registration: CONFLICT for the
 * `DeviceModel` registration conflicts, the error itself for anything else.
 */
export const toRegistrationError = (error: unknown) =>
  error instanceof WorkspaceDevicePrivateConflictError ||
  error instanceof ManagedDeviceRegistrationConflictError
    ? new TRPCError({ code: 'CONFLICT', message: error.message })
    : error;

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
