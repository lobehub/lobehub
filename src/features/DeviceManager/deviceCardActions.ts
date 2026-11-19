import type { DeviceListItem } from '@lobechat/types';
import { isManagedCloudDevice } from '@lobechat/types';

type CardDevice = Pick<DeviceListItem, 'identitySource' | 'registered' | 'scope'>;

/**
 * The visibility a device page shows: only persisted workspace rows have one.
 * Ghost rows (online, not yet registered) and personal devices show none.
 */
export const shownDeviceVisibility = (
  device: Pick<DeviceListItem, 'registered' | 'scope' | 'visibility'>,
) => (device.scope === 'workspace' && device.registered ? device.visibility : null);

/**
 * Whether the caller may publish this device to the workspace or make it
 * private. Only persisted workspace rows carry a visibility (ghosts and
 * personal devices don't), and the toggle is enroller-only: an owner demoting
 * another member's public device would move it into that member's private
 * list, appropriating their data. The server rejects other writers as the
 * backstop.
 */
export const canToggleDeviceVisibility = (
  device: Pick<DeviceListItem, 'enroller' | 'registered' | 'scope'>,
  currentUserId: string | null | undefined,
): boolean =>
  device.scope === 'workspace' &&
  device.registered &&
  !!currentUserId &&
  device.enroller?.userId === currentUserId;

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
