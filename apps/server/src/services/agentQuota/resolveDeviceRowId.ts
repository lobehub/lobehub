import type { DeviceModel } from '@/database/models/device';

/**
 * Clients and dispatch know a device by its gateway id (the string
 * `devices.device_id`, e.g. `agencyConfig.boundDeviceId`), but quota rows
 * reference the `devices.id` uuid. `undefined` when it does not resolve.
 *
 * A workspace device's identity is `(workspaceId, deviceId)` — `userId` only
 * records the first enroller — so the personal `(userId, deviceId)` lookup
 * misses a machine any other member enrolled. Try the workspace-scoped lookup
 * first when there is a workspace (it also applies the device's visibility
 * rules), then fall back to the caller's own devices.
 */
export const resolveDeviceRowId = async (
  deviceModel: Pick<DeviceModel, 'findByDeviceId' | 'findWorkspaceDeviceById'>,
  workspaceId: string | null | undefined,
  gatewayDeviceId: string | undefined,
): Promise<string | undefined> => {
  if (!gatewayDeviceId) return undefined;
  const row =
    (workspaceId ? await deviceModel.findWorkspaceDeviceById(gatewayDeviceId) : undefined) ??
    (await deviceModel.findByDeviceId(gatewayDeviceId));
  return row?.id;
};
