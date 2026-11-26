import { isManagedCloudDevice } from '@lobechat/types';

import { onManagedDeviceRemoved } from '@/business/server/managedDevice';
import type { DeviceItem } from '@/database/schemas';

type RemovedDevice = Pick<DeviceItem, 'deviceId' | 'identitySource' | 'userId' | 'workspaceId'>;

/**
 * Report each removed managed cloud device to the deployment. Call it after
 * the rows are deleted. A hook failure is logged and never fails the removal.
 */
export const reportManagedDevicesRemoved = async (
  removed: RemovedDevice[] | undefined,
): Promise<void> => {
  for (const row of removed ?? []) {
    if (!isManagedCloudDevice(row)) continue;

    try {
      await onManagedDeviceRemoved({
        deviceId: row.deviceId,
        userId: row.userId,
        ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      });
    } catch (error) {
      console.error('[device] Failed to report a removed managed device:', {
        deviceId: row.deviceId,
        error,
      });
    }
  }
};
