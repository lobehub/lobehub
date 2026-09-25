'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateAction, AppUpdateHint, useDeviceAppUpdate } from './AppUpdate';
import { getChannelKind, getChannelVersion } from './channelKind';
import FieldLabel from './FieldLabel';

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
}));

interface ConnectionRowProps {
  channel: string | null;
  /** Right-aligned action, e.g. the desktop app's update button. */
  extra?: ReactNode;
  /** Status line under the row. */
  footer?: ReactNode;
  live: boolean;
  status?: ReactNode;
  version?: string;
}

const ConnectionRow = ({ channel, extra, footer, live, status, version }: ConnectionRowProps) => (
  <Flexbox gap={4}>
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
        <span
          className={styles.dot}
          style={{ background: live ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
        />
        {channel && <Tag size={'small'}>{channel}</Tag>}
        {version && <Text fontSize={12}>v{version}</Text>}
        {status && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {status}
          </Text>
        )}
      </Flexbox>
      {extra}
    </Flexbox>
    {footer}
  </Flexbox>
);

interface ConnectionsProps {
  canEdit: boolean;
  device: DeviceListItem;
}

/**
 * The device's live connections, one row per client with the version it runs.
 * The desktop app's row also carries its remote update — confirmed only once
 * the device reconnects on the new version.
 */
const Connections = ({ canEdit, device }: ConnectionsProps) => {
  const { t } = useTranslation('setting');

  const channels = device.channels ?? [];
  const kinds = channels.map((c) => getChannelKind(c.channel));
  const desktopIndex = kinds.indexOf('desktop');
  const hasDesktopChannel = desktopIndex !== -1;

  const update = useDeviceAppUpdate({
    deviceId: device.deviceId,
    enabled: canEdit && hasDesktopChannel,
    hasCliChannel: kinds.includes('cli'),
  });

  const versionOf = (index: number) =>
    getChannelVersion(kinds[index], device.metadata, update.currentVersion);

  // A restart drops the desktop app offline; keep following it in place of
  // its row until it reconnects.
  const restartInFlight =
    !hasDesktopChannel && update.view.kind !== 'loading' && update.view.kind !== 'unavailable';

  const updateSlots = {
    extra: canEdit ? <AppUpdateAction update={update} /> : undefined,
    footer: <AppUpdateHint update={update} />,
  };

  return (
    <Flexbox gap={8}>
      <FieldLabel>{t('devices.detail.connections')}</FieldLabel>
      {channels.map((channel, index) => (
        <ConnectionRow
          live
          channel={channel.channel}
          key={`${channel.connectedAt}-${index}`}
          status={t('devices.channel.connected', { time: dayjs(channel.connectedAt).fromNow() })}
          version={versionOf(index)}
          {...(index === desktopIndex ? updateSlots : undefined)}
        />
      ))}
      {restartInFlight && (
        <ConnectionRow
          channel={'desktop'}
          live={false}
          version={getChannelVersion('desktop', device.metadata, update.currentVersion)}
          {...updateSlots}
        />
      )}
      {channels.length === 0 && !restartInFlight && (
        <ConnectionRow
          channel={null}
          live={false}
          status={`${t('devices.status.offline')} · ${t('devices.lastSeen', {
            time: dayjs(device.lastSeen).fromNow(),
          })}`}
        />
      )}
    </Flexbox>
  );
};

export default Connections;
