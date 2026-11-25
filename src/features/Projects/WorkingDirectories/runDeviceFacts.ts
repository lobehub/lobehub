import { type DeviceListItem, isManagedCloudDevice } from '@lobechat/types';

/** What a run device's card says about the machine beside its presence. */
export interface RunDeviceFacts {
  /** A managed cloud device: LobeHub runs it, and running on it counts toward the plan. */
  managed: boolean;
  /**
   * Who shared the machine, when it is someone else's: a workspace device
   * another member enrolled. Undefined for the viewer's own machines.
   */
  sharedBy?: string;
}

export const runDeviceFacts = (
  device: Pick<DeviceListItem, 'enroller' | 'identitySource' | 'scope'> | undefined,
  currentUserId: string | undefined,
): RunDeviceFacts => {
  if (!device) return { managed: false };
  const enroller = device.enroller;
  const sharedBy =
    device.scope === 'workspace' && enroller && enroller.userId !== currentUserId
      ? enroller.fullName || enroller.username || undefined
      : undefined;
  return { managed: isManagedCloudDevice(device), ...(sharedBy && { sharedBy }) };
};
