import type { DeviceListItem } from '@lobechat/types';

import type { DeviceWakeStatus } from '@/features/WorkingDirectory/sources/useManagedDeviceWake';
import { canHostTerminal } from '@/store/device';

/**
 * Whether the device detail page can open a shell on the device right now:
 * - `checking`: the device list has not confirmed the device's presence yet.
 * - `waking` / `wakeSlow` / `wakeFailed`: a sleeping managed cloud device was
 *   asked to start; the shell waits for it to come online.
 * - `offline`: nothing on the device is connected to answer.
 * - `unsupported`: it is online, but through a client too old to host a terminal.
 * - `ready`: open the shell.
 */
export type DeviceTerminalAvailability =
  'checking' | 'offline' | 'ready' | 'unsupported' | 'wakeFailed' | 'wakeSlow' | 'waking';

export const getTerminalAvailability = (
  device: DeviceListItem,
  wakeStatus: DeviceWakeStatus,
): DeviceTerminalAvailability => {
  switch (wakeStatus) {
    case 'checking': {
      return 'checking';
    }
    case 'waking': {
      return 'waking';
    }
    case 'starting': {
      return 'wakeSlow';
    }
    case 'failed': {
      return 'wakeFailed';
    }
  }

  // A row restored from storage has not been confirmed online or offline.
  if (device.onlineUnknown) return 'checking';
  if (!device.online) return 'offline';
  return canHostTerminal(device) ? 'ready' : 'unsupported';
};

/** Why opening the shell failed, as the panel words it. */
export type TerminalOpenErrorKind = 'failed' | 'offline' | 'unsupported';

// Mirrors TERMINAL_UNSUPPORTED_MESSAGE in @lobechat/device-control: a client
// without PTY support refuses every terminal call with it.
const TERMINAL_UNSUPPORTED = 'does not support a terminal';
// A client that predates the terminal RPCs altogether.
const UNKNOWN_METHOD = 'Unknown device RPC method';
const OFFLINE =
  /DEVICE_NOT_FOUND|DEVICE_OFFLINE|device (?:is )?offline|desktop offline|not connected/i;

/** Sorts a failed `createTerminalSession` into the cases the panel words differently. */
export const classifyTerminalOpenError = (error: unknown): TerminalOpenErrorKind => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes(TERMINAL_UNSUPPORTED) || message.includes(UNKNOWN_METHOD)) {
    return 'unsupported';
  }
  if (OFFLINE.test(message)) return 'offline';
  return 'failed';
};
