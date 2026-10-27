import type { DeviceListeningPortsResult } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/**
 * The Working Sidebar "Ports" row reads: a device's tunnel links and the ports
 * it is listening on. Replicas so a reload paints the last links / ports on the
 * first frame and the reads only confirm them.
 *
 * Rows are partitioned by the cache scope (user + workspace). Links are keyed
 * by device; ports by device + project directory (the directory decides which
 * ports count as the project's). A stored link is the clean URL — the token
 * that opens it is minted per click and never stored.
 */
export interface DeviceTunnelLink {
  createdAt: number;
  deviceId: string;
  expiresAt?: number;
  hostname: string;
  port: number;
  slug: string;
  url: string;
}

/**
 * The stored shape of a link: only its clean fields. A create response also
 * carries `openUrl`, whose one-shot token is a credential and must never reach
 * memory or storage.
 */
export const toStoredTunnelLink = ({
  createdAt,
  deviceId,
  expiresAt,
  hostname,
  port,
  slug,
  url,
}: DeviceTunnelLink): DeviceTunnelLink => ({
  createdAt,
  deviceId,
  expiresAt,
  hostname,
  port,
  slug,
  url,
});

export interface DeviceTunnelsParams {
  deviceId: string;
}

export interface DeviceListeningPortsParams {
  cwd?: string;
  deviceId: string;
}

export const deviceTunnelsKey = ({ deviceId }: DeviceTunnelsParams) => deviceId;

export const deviceListeningPortsKey = ({ cwd, deviceId }: DeviceListeningPortsParams) =>
  `${deviceId}\u0000${cwd ?? ''}`;

/** A dev machine listens on dozens of ports; storage keeps a bounded list. */
export const MAX_PERSISTED_PORTS = 100;

export const toPersistedListeningPorts = (
  data: DeviceListeningPortsResult,
): DeviceListeningPortsResult => ({ ...data, ports: data.ports.slice(0, MAX_PERSISTED_PORTS) });

export const deviceTunnelsResource = defineReplica<DeviceTunnelsParams, DeviceTunnelLink[]>({
  key: deviceTunnelsKey,
  name: 'deviceTunnelLinks',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * Which ports were listening at the last probe. A persisted row is a paint-only
 * stand-in: whether those ports are still up is unknown until the device
 * answers (see `useFetchDeviceListeningPorts`' `isConfirmed`).
 */
export const deviceListeningPortsResource = defineReplica<
  DeviceListeningPortsParams,
  DeviceListeningPortsResult
>({
  key: deviceListeningPortsKey,
  name: 'deviceListeningPorts',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});
