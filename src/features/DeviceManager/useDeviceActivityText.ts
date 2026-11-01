import type { DeviceListItem } from '@lobechat/types';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

/**
 * A device's presence as one line — "Online · Connected 5 minutes ago" or
 * "Last connected 2 days ago". Shared by the device card footer and the
 * conversation Overview, so both describe the same machine the same way.
 *
 * Online reads the gateway's live `connectedAt` from `channels[0]` — the
 * newest connection, since the pool is sorted newest-first in
 * `deviceGateway.queryDeviceList`. That is the same channel
 * `sortDevicesByActivity` ranks a row by, so the label always explains the
 * row's position.
 *
 * Offline can only report `lastSeen`, which is stamped on register — and
 * every client registers right before opening its WS (`gatewayConnectionSrv`,
 * CLI `registerDevice`) — so it means "last CONNECTED", not "last active".
 *
 * A single connection drops the "1 connection" count — it is the common case
 * and would truncate a narrow line.
 *
 * A row restored from the persisted list (`onlineUnknown`) has no channels by
 * construction, so it reads as "checking" rather than as offline.
 */
export const useDeviceActivityText = (device: DeviceListItem) => {
  const { t } = useTranslation('setting');
  const channels = device.channels ?? [];

  if (device.onlineUnknown) return t('devices.status.checking');

  if (channels.length === 0)
    return t('devices.lastSeen', { time: dayjs(device.lastSeen).fromNow() });

  const status =
    channels.length > 1
      ? t('devices.status.onlineConnections', { count: channels.length })
      : t('devices.status.online');

  return `${status} · ${t('devices.channel.connected', {
    time: dayjs(channels[0]?.connectedAt ?? device.lastSeen).fromNow(),
  })}`;
};
