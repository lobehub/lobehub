import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { DeviceModel } from '@/database/models/device';

interface DeviceBindingCtx {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
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
