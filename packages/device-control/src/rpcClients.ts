import type { DeviceClient } from '@lobechat/types';

import type { DeviceRpcMethod } from './dispatch';

// Dependency-free on purpose: the server imports this through the
// `@lobechat/device-control/rpc-clients` subpath. The package root pulls in
// the local file shell and native agent runtimes, which would be traced into
// every serverless function.

/**
 * RPC methods only the desktop app implements: the CLI daemon passes no
 * handler for them (no recoverable trash, no self-update), so a call that lands
 * on `lh connect` is rejected.
 */
const DESKTOP_ONLY_RPC_METHODS: ReadonlySet<string> = new Set<DeviceRpcMethod>([
  'trashLocalFiles',
  'getAppUpdateState',
  'checkAppUpdate',
  'installAppUpdate',
]);

/**
 * RPC methods only the CLI daemon (`lh connect`) implements: the desktop app
 * passes no CLI self-update or restart handler, so a call that lands on the
 * desktop is rejected.
 */
const CLI_ONLY_RPC_METHODS: ReadonlySet<string> = new Set<DeviceRpcMethod>([
  'getCliUpdateState',
  'checkCliUpdate',
  'restartCli',
]);

/** Device clients that can serve `method`; `undefined` means any client. */
export const deviceRpcClients = (method: string): DeviceClient[] | undefined => {
  if (DESKTOP_ONLY_RPC_METHODS.has(method)) return ['desktop'];
  if (CLI_ONLY_RPC_METHODS.has(method)) return ['cli'];
  return undefined;
};
