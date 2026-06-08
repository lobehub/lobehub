import type { deviceService } from '@/services/device';

/**
 * A device row as returned by `device.listDevices` — either a registered device
 * or an online-only "ghost" (connected but not yet persisted). Inferred from the
 * service so the store stays in sync with the contract.
 */
export type DeviceListItem = Awaited<ReturnType<typeof deviceService.listDevices>>[number];

export interface DeviceState {
  devices: DeviceListItem[];
  isDevicesInit: boolean;
}

export const initialState: DeviceState = {
  devices: [],
  isDevicesInit: false,
};
