import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type DeviceAction, deviceSlice } from './action';
import { type DeviceState, initialState } from './initialState';

export interface DeviceStore extends DeviceState, DeviceAction {
  /* empty */
}

const createStore: StateCreator<DeviceStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...flattenActions<DeviceAction>([deviceSlice(...parameters)]),
});

const devtools = createDevtools('device');

export const useDeviceStore = createWithEqualityFn<DeviceStore>()(devtools(createStore), shallow);

expose('device', useDeviceStore);

export const getDeviceStoreState = () => useDeviceStore.getState();
