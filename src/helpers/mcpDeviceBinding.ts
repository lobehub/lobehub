import { isDesktop } from '@lobechat/const';

import { getElectronStoreState } from '@/store/electron';

/**
 * Whether an MCP server bound to `boundDeviceId` must run on a device other
 * than this client: always on the web, and on a desktop that isn't the bound
 * device. Such a server's calls, tool listings and connection tests go through
 * the server, which tunnels them to the bound device; this desktop's own
 * process never runs them. Unbound servers (`undefined`) keep their routing.
 *
 * Compared with this desktop's personal device id: a workspace device bound on
 * this same machine has its own id, and reaches this desktop through the
 * gateway's workspace channel, so it is still correct (one round trip longer).
 */
export const runsOnAnotherDevice = (boundDeviceId: string | null | undefined): boolean =>
  !!boundDeviceId &&
  !(isDesktop && getElectronStoreState().gatewayDeviceInfo?.deviceId === boundDeviceId);
