import { DeviceModel } from '@/database/models/device';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

import { isRequesterCredentialDevice } from './deviceScope';

export const isRequesterCredentialEnforced = async (
  db: LobeChatDatabase,
  params: { deviceId: string; ownerUserId: string; workspaceId?: string },
): Promise<boolean> => {
  if (!params.workspaceId) return false;

  const device = await new DeviceModel(
    db,
    params.ownerUserId,
    params.workspaceId,
  ).findWorkspaceDeviceById(params.deviceId);
  if (!device?.workspaceId || !isRequesterCredentialDevice(device)) return false;

  return new WorkspaceModel(db, params.ownerUserId).getScmRequesterCredential(device.workspaceId);
};
