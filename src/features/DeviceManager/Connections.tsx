'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateAction, AppUpdateHint, useDeviceAppUpdate } from './AppUpdate';
import { getChannelKind, getChannelVersion } from './channelKind';
import FieldLabel from './FieldLabel';

interface ConnectionCardProps {
  channel: string;
  /** Right side of the status line, e.g. the desktop app's update button. */
  extra?: ReactNode;
  /** Left side of the status line: where the connection or its update stands. */
  status: ReactNode;
  version?: string;
}

/** One client connection: which client and version, then its status and action on one line. */
const ConnectionCard = ({ channel, extra, status, version }: ConnectionCardProps) => (
  <Block gap={8} paddingBlock={10} paddingInline={12} variant={'outlined'}>
    <Flexbox horizontal align={'center'} gap={8}>
      <Tag size={'small'}>{channel}</Tag>
      {version && <Text fontSize={13}>v{version}</Text>}
    </Flexbox>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        {status}
      </Flexbox>
      {extra}
    </Flexbox>
  </Block>
);

interface ConnectionsProps {
  canEdit: boolean;
  device: DeviceListItem;
}

/**
 * The device's live connections, one card per client with the version it runs.
 * The desktop app's card also carries its remote update — confirmed only once
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

  // A restart drops the desktop app offline; keep following it in place of
  // its card until it reconnects.
  const restartInFlight =
    !hasDesktopChannel && update.view.kind !== 'loading' && update.view.kind !== 'unavailable';

  const plainStatus = (text: string) => (
    <Text ellipsis fontSize={12} type={'secondary'}>
      {text}
    </Text>
  );

  const desktopCard = (channel: string, connectedText: string, key?: string) => (
    <ConnectionCard
      channel={channel}
      extra={canEdit ? <AppUpdateAction update={update} /> : undefined}
      key={key}
      status={<AppUpdateHint fallback={plainStatus(connectedText)} update={update} />}
      version={getChannelVersion('desktop', device.metadata, update.currentVersion)}
    />
  );

  return (
    <Flexbox gap={8}>
      <FieldLabel>{t('devices.detail.connections')}</FieldLabel>
      {channels.map((channel, index) => {
        const key = `${channel.connectedAt}-${index}`;
        const label = channel.channel ?? t('devices.channel.unknown');
        const connectedText = t('devices.channel.connected', {
          time: dayjs(channel.connectedAt).fromNow(),
        });
        if (index === desktopIndex) return desktopCard(label, connectedText, key);

        return (
          <ConnectionCard
            channel={label}
            key={key}
            status={plainStatus(connectedText)}
            version={getChannelVersion(kinds[index], device.metadata)}
          />
        );
      })}
      {restartInFlight && desktopCard('desktop', t('devices.status.offline'))}
      {channels.length === 0 &&
        !restartInFlight &&
        plainStatus(
          `${t('devices.status.offline')} · ${t('devices.lastSeen', {
            time: dayjs(device.lastSeen).fromNow(),
          })}`,
        )}
    </Flexbox>
  );
};

export default Connections;
