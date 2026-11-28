import { useState } from 'react';

import type { DeviceTerminalAvailability } from './availability';

/**
 * Whether the shell may run, given the device's availability.
 *
 * Availability only gates the first shell. A device list refetch can briefly
 * report the device offline or unconfirmed; ending a live shell on that would
 * throw away its scrollback and whatever it was running. Once the device has
 * been ready, the gate stays open and the session's own retry rides out a real
 * disconnect.
 */
export const useTerminalGate = (availability: DeviceTerminalAvailability): boolean => {
  const [started, setStarted] = useState(false);
  const ready = availability === 'ready';
  // Adjusting state while rendering, so the gate opens in the same render.
  if (ready && !started) setStarted(true);
  return started || ready;
};
