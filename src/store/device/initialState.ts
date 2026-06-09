import type { DeviceListItem } from '@lobechat/types';

export interface DeviceState {
  devices: DeviceListItem[];
  isDevicesInit: boolean;
}

export const initialState: DeviceState = {
  devices: [],
  isDevicesInit: false,
};
