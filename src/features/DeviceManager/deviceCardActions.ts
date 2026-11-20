import type { DeviceListItem } from '@lobechat/types';
import { isManagedCloudDevice } from '@lobechat/types';

type CardDevice = Pick<DeviceListItem, 'identitySource' | 'registered' | 'scope'>;

/**
 * Whether the device card offers "Share to Workspace". Only a registered
 * personal device the user connected can be shared: the share flow asks the
 * machine's desktop app for a workspace identity, and the server refuses a
 * managed cloud device.
 */
export const canOfferDeviceShare = (device: CardDevice): boolean =>
  device.scope === 'personal' && device.registered && !isManagedCloudDevice(device);

/**
 * Locale key (namespace `setting`) of the remove confirmation body. Removing a
 * managed cloud device deletes it. A connected device can register again.
 */
export const removeConfirmDescKey = (
  device: Pick<DeviceListItem, 'identitySource'>,
): 'devices.managed.remove.confirmDesc' | 'devices.remove.confirmDesc' =>
  isManagedCloudDevice(device)
    ? 'devices.managed.remove.confirmDesc'
    : 'devices.remove.confirmDesc';
