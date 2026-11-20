import { type ElectronState } from '@/store/electron/initialState';

import { GATEWAY_STABLE_DEVICE_ID_KEY } from '../projection';

/** This desktop's stable gateway device id; `undefined` until resolved, `null` = none. */
const gatewayStableDeviceId = (s: ElectronState) =>
  s.gatewayStableDeviceIdMap[GATEWAY_STABLE_DEVICE_ID_KEY]?.deviceId;

export const electronGatewaySelectors = {
  gatewayStableDeviceId,
};
