import { defineReplica } from '@/libs/replica';

/** This machine has one stable gateway device id, so the replica has one entry. */
export const GATEWAY_STABLE_DEVICE_ID_KEY = 'self';

/** `deviceId: null` = the desktop could not resolve one (signed out of the gateway). */
export interface GatewayStableDeviceId {
  deviceId: string | null;
}

/**
 * This desktop's stable gateway device id. Unlike `gatewayDeviceInfo`, which
 * holds the install's fallback UUID until the gateway connects, this is the
 * user-scoped id the server keys devices by. It paints from local storage on a
 * reload and is re-derived over IPC behind it.
 */
export const gatewayStableDeviceIdResource = defineReplica<string, GatewayStableDeviceId>({
  key: (key) => key,
  name: 'electronGatewayStableDeviceId',
  storage: 'localStorage',
  version: 1,
});
