import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel } from '@/database/models/device';

import { canOperateWorkspaceDevice } from '../deviceWorkspaceGuard';

interface DeviceBindingCtx {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
  workspaceRole?: WorkspaceRole;
}

/**
 * Whether a connector write may bind the connector to the device its metadata
 * names (`metadata.boundDeviceId`). A binding pins every call to that device,
 * so it must be one the connector's every runner can reach:
 *
 * - personal connector (no `workspaceId`): one of the caller's personal
 *   devices — its runs only ever reach the owner's own pool;
 * - workspace connector: a PUBLIC device of that workspace. A private
 *   enrollment resolves only for the member who enrolled it, so other
 *   members' runs could never reach it.
 *
 * A binding the write keeps unchanged is not checked again: the device may
 * have been unshared since, and an unrelated edit must not fail on it (its
 * calls already fail with the reason).
 *
 * Throws `BAD_REQUEST` for a binding outside those devices.
 */
export const assertConnectorDeviceBindingAllowed = async (
  ctx: DeviceBindingCtx,
  metadata: Record<string, unknown> | null | undefined,
  previousMetadata?: Record<string, unknown> | null,
): Promise<void> => {
  const deviceId = metadata?.boundDeviceId;
  if (deviceId === undefined || deviceId === previousMetadata?.boundDeviceId) return;
  if (typeof deviceId !== 'string' || !deviceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid bound device' });
  }

  const allowed = ctx.workspaceId
    ? (
        await new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId).findWorkspaceDeviceById(
          deviceId,
        )
      )?.visibility === 'public'
    : !!(await new DeviceModel(ctx.serverDB, ctx.userId).findPersonalByDeviceId(deviceId));

  if (!allowed) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: ctx.workspaceId
        ? 'A workspace MCP server can only be bound to a shared (public) device of this workspace.'
        : 'An MCP server can only be bound to one of your own devices.',
    });
  }
};

/**
 * Whether the caller may run an MCP server on a bound device right now (a
 * connection test starts its stdio command or reaches its network there). In
 * a workspace that is operating the machine, so the device guard's rule
 * applies: any member on a public device, never a viewer, and a private one
 * only for its enroller or an owner. A personal binding only ever reaches the
 * caller's own devices (the gateway pool is per user), so it needs no check.
 *
 * Throws `NOT_FOUND` for a device outside the workspace, `FORBIDDEN` otherwise.
 */
export const assertBoundDeviceOperable = async (
  ctx: DeviceBindingCtx,
  deviceId: string | undefined,
): Promise<void> => {
  if (!deviceId || !ctx.workspaceId) return;

  const row = await new DeviceModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId,
  ).findWorkspaceDeviceById(deviceId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
  if (!canOperateWorkspaceDevice(ctx.workspaceRole, ctx.userId, row)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You cannot run an MCP server on this workspace device.',
    });
  }
};
