'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
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

interface ConnectionCardProps {
  channel: string;
  /** Right-aligned action, e.g. the desktop app's update button. */
  extra?: ReactNode;
  /** False while the client is away, e.g. restarting into an update. */
  live: boolean;
  /** Where the connection or its update stands. */
  status: ReactNode;
  version?: string;
}

/** One client connection on a single line: state dot, client, version, status, action. */
const ConnectionCard = ({ channel, extra, live, status, version }: ConnectionCardProps) => (
  <Block
    horizontal
    align={'center'}
    gap={8}
    paddingBlock={8}
    paddingInline={12}
    variant={'outlined'}
  >
    <span
      className={styles.dot}
      style={{ background: live ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
    />
    <Text weight={500}>{channel}</Text>
    {version && <Tag size={'small'}>v{version}</Tag>}
    <Flexbox flex={1} style={{ minWidth: 0 }}>
      {status}
    </Flexbox>
    {extra}
  </Block>
);

interface ConnectionsProps {
  canEdit: boolean;
  device: DeviceListItem;
}

/**
 * The device's live connections, one single-line card per client with the version it runs.
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

  const desktopCard = (channel: string, connectedText: string, live: boolean, key?: string) => (
    <ConnectionCard
      channel={channel}
      extra={canEdit ? <AppUpdateAction update={update} /> : undefined}
      key={key}
      live={live}
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
        if (index === desktopIndex) return desktopCard(label, connectedText, true, key);

        return (
          <ConnectionCard
            live
            channel={label}
            key={key}
            status={plainStatus(connectedText)}
            version={getChannelVersion(kinds[index], device.metadata)}
          />
        );
      })}
      {restartInFlight && desktopCard('desktop', t('devices.status.offline'), false)}
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
