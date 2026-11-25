import { type DeviceListItem, isManagedCloudDevice } from '@lobechat/types';

import { getPlatformLabel } from '@/features/DeviceManager/getDeviceIcon';

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

/**
 * The machine's system as a card says it — OS and CPU architecture
 * (`macOS · arm64`). The device list's own record wins; a device it does not
 * list falls back to the platform the folder remembered, without an
 * architecture.
 */
export const runDevicePlatform = (
  device: Pick<DeviceListItem, 'architecture' | 'platform'> | undefined,
  rememberedPlatform?: string | null,
) =>
  device
    ? getPlatformLabel(device.platform ?? rememberedPlatform, device.architecture)
    : getPlatformLabel(rememberedPlatform);
