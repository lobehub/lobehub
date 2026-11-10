import { isManagedCloudDevice, isWakeableManagedDevice } from '@lobechat/types';

export interface DeviceOptionState {
  /** Locale key (namespace `chat`) for an offline row's status. */
  offlineLabelKey:
    'heteroAgent.executionTarget.offline' | 'heteroAgent.executionTarget.wakesWhenUsed';
  /** Locale key (namespace `chat`) for the row's reconnect or wake control. */
  reconnectLabelKey: 'heteroAgent.executionTarget.reconnect' | 'heteroAgent.executionTarget.wake';
  /** Whether the user may pick the row. */
  selectable: boolean;
  /** Whether the row shows its reconnect or wake control. */
  showReconnect: boolean;
}

/**
 * How one device row of the execution environment picker behaves.
 *
 * - An online device is selectable.
 * - A managed cloud device that sleeps is selectable too: a run bound to it
 *   wakes it before dispatch. It reads "Wakes when used", and its control
 *   wakes it through the server.
 * - Any other offline device is not selectable, and its control reconnects
 *   it through the desktop app.
 * - A managed device that cannot be woken (failed, deleting) has no control:
 *   the desktop app cannot reach it.
 */
export const getDeviceOptionState = (
  // Structural, so a `managedPhase` on the list row narrows it when present.
  device: Parameters<typeof isWakeableManagedDevice>[0],
  { presenceUnknown }: { presenceUnknown: boolean },
): DeviceOptionState => {
  const wakeable = isWakeableManagedDevice(device);

  return {
    offlineLabelKey: wakeable
      ? 'heteroAgent.executionTarget.wakesWhenUsed'
      : 'heteroAgent.executionTarget.offline',
    reconnectLabelKey: wakeable
      ? 'heteroAgent.executionTarget.wake'
      : 'heteroAgent.executionTarget.reconnect',
    selectable: device.online || wakeable,
    showReconnect:
      !device.online && !presenceUnknown && (wakeable || !isManagedCloudDevice(device)),
  };
};
