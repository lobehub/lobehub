import { isWakeableManagedDevice } from '@lobechat/types';
import { useCallback, useEffect, useState } from 'react';

import { wakeManagedDeviceAndWait } from '@/features/ChatInput/ControlBar/reconnectDevice';
import { deviceService } from '@/services/device';
import { useDeviceList } from '@/store/device/useDeviceList';

/**
 * Whether a device's folders can be listed yet:
 * - `checking`: the device list has not confirmed the device's presence yet.
 * - `waking`: a sleeping managed cloud device was asked to start; waiting for it.
 * - `starting`: it accepted the wake but is still not online after the wait.
 * - `failed`: the wake request failed.
 * - `ready`: list the folders. Also the answer for any device this hook cannot
 *   wake (an ordinary connected device, an unknown id, a failed device list),
 *   which keeps the listing's own offline error.
 */
export type DeviceWakeStatus = 'checking' | 'failed' | 'ready' | 'starting' | 'waking';

export interface ManagedDeviceWake {
  /** Ask the device to start again after `starting` or `failed`. */
  retry: () => void;
  status: DeviceWakeStatus;
}

/**
 * Wake a sleeping managed cloud device as soon as a surface needs it, without
 * the user pressing "Wake now" in the device picker first. A listing for such
 * a device answers "unavailable" until it is online, so the folder picker waits
 * on this before it lists.
 */
export const useManagedDeviceWake = (deviceId: string): ManagedDeviceWake => {
  const { data: devices, error, isConfirmed, mutate } = useDeviceList();
  const device = devices?.find((item) => item.deviceId === deviceId);
  // Only a server-confirmed row says the device is asleep: a persisted row
  // reads offline until then.
  const wakeable = isConfirmed && !!device && isWakeableManagedDevice(device);
  const scope = device?.scope;

  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{
    attempt: number;
    deviceId: string;
    status: 'failed' | 'starting';
  }>();

  useEffect(() => {
    if (!wakeable || !scope) return;
    let stopped = false;

    wakeManagedDeviceAndWait(
      { deviceId, scope },
      {
        refreshDevices: mutate,
        shouldStop: () => stopped,
        wakeManagedDevice: (input) => deviceService.wakeManagedDevice(input),
      },
    )
      .then((result) => {
        // `connected` needs no state: the refreshed list shows the device online.
        if (!stopped && result === 'starting')
          setOutcome({ attempt, deviceId, status: 'starting' });
      })
      .catch((cause) => {
        console.error('Failed to wake the managed device for folder browsing', cause);
        if (!stopped) setOutcome({ attempt, deviceId, status: 'failed' });
      });

    return () => {
      stopped = true;
    };
  }, [attempt, deviceId, mutate, scope, wakeable]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (wakeable) {
    const settled = outcome?.attempt === attempt && outcome.deviceId === deviceId;
    return { retry, status: settled ? outcome.status : 'waking' };
  }
  // A persisted row that may still be a sleeping device: wait for the server.
  if (!isConfirmed && !error && !device?.online) return { retry, status: 'checking' };

  return { retry, status: 'ready' };
};
