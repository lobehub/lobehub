import type { DeviceListItem, DeviceMetricSeries } from '@lobechat/types';

import { getPlatformLabel } from './getDeviceIcon';

export interface DeviceHoverSummary {
  architecture?: string;
  /** Live connections; only meaningful while online. */
  connections: number;
  cores?: number;
  diskTotalBytes?: number;
  /**
   * Who enrolled a workspace device. `null` names an enroller the list could
   * not resolve; `undefined` means the row has no enroller to show.
   */
  enrollerName?: string | null;
  hostname?: string;
  /** When the device last (re)connected — its newest channel, else when it last registered. */
  lastConnectedAt: string;
  memoryTotalBytes?: number;
  online: boolean;
  /** A persisted row the server has not confirmed: `online` is a placeholder. */
  onlineUnknown: boolean;
  platformLabel?: string;
  workingDir?: string;
}

/**
 * What the picker's hover panel shows for one device. Fields the device never
 * reported come back `undefined` so every row renders the same placeholder.
 */
export const buildDeviceHoverSummary = (
  device: DeviceListItem,
  series?: DeviceMetricSeries,
): DeviceHoverSummary => {
  const channels = device.channels ?? [];

  return {
    architecture: device.architecture || undefined,
    connections: channels.length,
    cores: series?.cpuCount || undefined,
    diskTotalBytes: series?.diskTotalBytes || undefined,
    enrollerName:
      device.scope === 'workspace' && device.enroller
        ? device.enroller.fullName || device.enroller.username || null
        : undefined,
    hostname: device.hostname || undefined,
    lastConnectedAt: channels[0]?.connectedAt ?? device.lastSeen,
    memoryTotalBytes: series?.memoryTotalBytes || undefined,
    online: device.online,
    onlineUnknown: !!device.onlineUnknown,
    platformLabel: getPlatformLabel(device.platform),
    workingDir: device.defaultCwd || undefined,
  };
};
