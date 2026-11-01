import type { GatewayHttpClient } from '@lobechat/device-gateway-client';

/** Returns the lazily built gateway client, or `null` when the gateway is not configured. */
export type DeviceClientGetter = () => GatewayHttpClient | null;

/** A module function's arguments after its leading `getClient`. */
export type DeviceRpcArgs<F> = F extends (
  getClient: DeviceClientGetter,
  ...args: infer A
) => unknown
  ? A
  : never;
