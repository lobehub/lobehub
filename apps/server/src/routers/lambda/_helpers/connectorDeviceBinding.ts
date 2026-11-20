import type { LobeChatDatabase } from '@lobechat/database';
import type { ConnectorVisibility } from '@lobechat/types';
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

/** A connector write, as far as its device binding is concerned. */
export interface ConnectorBindingWrite {
  /** The connector after the write: its creator and who it is shared with. */
  connector: { userId: string; visibility: ConnectorVisibility };
  /** The metadata the write stores; `undefined` keeps the stored metadata. */
  metadata: Record<string, unknown> | null | undefined;
  /** The stored row before the write; absent for a new connector. */
  previous?: {
    metadata?: Record<string, unknown> | null;
    visibility: ConnectorVisibility;
  };
}

/**
 * Whether a connector write may bind the connector to the device its metadata
 * names (`metadata.boundDeviceId`). A binding pins every call to that device,
 * so it must be one every run that loads the connector can reach. Who runs it
 * follows the connector's visibility, the same split as connector loading:
 *
 * - personal connector (no `workspaceId`): one of the caller's personal
 *   devices — its runs only ever reach the owner's own pool;
 * - shared workspace connector: a PUBLIC device of that workspace. Every
 *   member's runs load it, and a private enrollment resolves only for the
 *   member who enrolled it;
 * - private workspace connector: a public device of the workspace, or a
 *   private one its creator enrolled. Only the creator's private agents load
 *   it, so the creator's own private device is always reachable.
 *
 * A binding the write keeps unchanged is not checked again: the device may
 * have been unshared since, and an unrelated edit must not fail on it (its
 * calls already fail with the reason). Sharing a private connector is the
 * exception: it hands the kept binding to every member's runs, so the binding
 * must then pass the shared rule.
 *
 * Throws `BAD_REQUEST` for a binding outside those devices.
 */
export const assertConnectorDeviceBindingAllowed = async (
  ctx: DeviceBindingCtx,
  { connector, metadata, previous }: ConnectorBindingWrite,
): Promise<void> => {
  const previousDeviceId = previous?.metadata?.boundDeviceId;
  const deviceId = metadata === undefined ? previousDeviceId : metadata?.boundDeviceId;
  if (deviceId === undefined) return;
  const sharing = previous?.visibility === 'private' && connector.visibility !== 'private';
  if (deviceId === previousDeviceId && !sharing) return;
  if (typeof deviceId !== 'string' || !deviceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid bound device' });
  }

  if (!ctx.workspaceId) {
    if (await new DeviceModel(ctx.serverDB, ctx.userId).findPersonalByDeviceId(deviceId)) return;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'An MCP server can only be bound to one of your own devices.',
    });
  }

  // Scoped like every workspace device read: public devices plus the caller's
  // own private ones
  const device = await new DeviceModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId,
  ).findWorkspaceDeviceById(deviceId);
  const isPrivateConnector = connector.visibility === 'private';
  if (
    device?.visibility === 'public' ||
    (isPrivateConnector && device?.visibility === 'private' && device.userId === connector.userId)
  ) {
    return;
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: isPrivateConnector
      ? 'A private MCP server can only be bound to a shared (public) device of this workspace or to a private device of the member who added it.'
      : sharing && deviceId === previousDeviceId
        ? 'This MCP server is bound to a private device, which other members cannot reach. Bind it to a shared (public) device of this workspace, or to Auto, before sharing it.'
        : 'A workspace MCP server can only be bound to a shared (public) device of this workspace.',
  });
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
