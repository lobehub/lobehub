'use client';

import { ActionIcon, DropdownMenu, Flexbox, Icon, Input, Tag, Text, Tooltip } from '@lobehub/ui';
import { confirmModal, Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  FolderIcon,
  MoreVerticalIcon,
  PencilLineIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

import { getDeviceIcon } from './getDeviceIcon';

export interface DeviceChannel {
  channel: string | null;
  connectedAt: string;
  hostname: string | null;
  platform: string | null;
}

export interface DeviceListItem {
  channels?: DeviceChannel[];
  defaultCwd: string | null;
  deviceId: string;
  friendlyName: string | null;
  hostname: string | null;
  identitySource: string | null;
  lastSeen: string;
  online: boolean;
  platform: string | null;
  recentCwds: string[];
  registered: boolean;
}

const styles = createStaticStyles(({ css }) => ({
  channels: css`
    margin-block-start: 4px;
    padding-inline-start: 30px;
  `,
  cwd: css`
    overflow: hidden;
    font-family: ${cssVar.fontFamilyCode};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  dotOffline: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${cssVar.colorTextQuaternary};
  `,
  dotOnline: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${cssVar.colorSuccess};
  `,
  icon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    padding-block: 12px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const DeviceItem = memo<{ device: DeviceListItem }>(({ device }) => {
  const { t } = useTranslation('setting');
  const utils = lambdaQuery.useUtils();

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');

  const updateDevice = lambdaQuery.device.updateDevice.useMutation({
    onSuccess: () => utils.device.listDevices.invalidate(),
  });
  const removeDevice = lambdaQuery.device.removeDevice.useMutation({
    onSuccess: () => utils.device.listDevices.invalidate(),
  });

  const displayName = device.friendlyName || device.hostname || device.deviceId;
  const isFallback = device.identitySource === 'fallback';
  // `channels` may be absent when the backend predates the channel-aware
  // `listDevices` shape; fall back to a single synthetic channel when online.
  const channels =
    device.channels ??
    (device.online
      ? [{ channel: null, connectedAt: device.lastSeen, hostname: null, platform: null }]
      : []);

  const openEdit = () => {
    setName(device.friendlyName ?? '');
    setCwd(device.defaultCwd ?? '');
    setEditOpen(true);
  };

  const handleSave = async () => {
    await updateDevice.mutateAsync({
      defaultCwd: cwd.trim() || null,
      deviceId: device.deviceId,
      friendlyName: name.trim() || null,
    });
    setEditOpen(false);
  };

  const handleRemove = () =>
    confirmModal({
      content: t('devices.remove.confirmDesc'),
      okButtonProps: { danger: true },
      okText: t('devices.actions.remove'),
      onOk: async () => {
        await removeDevice.mutateAsync({ deviceId: device.deviceId });
      },
      title: t('devices.remove.confirm'),
    });

  return (
    <>
      <Flexbox horizontal align={'flex-start'} className={styles.row} gap={12}>
        <span className={styles.icon} style={{ marginBlockStart: 2 }}>
          {getDeviceIcon(device.platform)}
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text ellipsis weight={500}>
              {displayName}
            </Text>
            {isFallback && (
              <Tooltip title={t('devices.fallbackTooltip')}>
                <Tag icon={<Icon icon={TriangleAlertIcon} />}>{t('devices.fallbackBadge')}</Tag>
              </Tooltip>
            )}
          </Flexbox>
          {device.defaultCwd && (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={FolderIcon} size={12} style={{ color: cssVar.colorTextQuaternary }} />
              <Text className={styles.cwd} style={{ fontSize: 12 }} type={'secondary'}>
                {device.defaultCwd}
              </Text>
            </Flexbox>
          )}
          <Flexbox className={styles.channels} gap={6}>
            {channels.length > 0 ? (
              channels.map((channel, index) => (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={6}
                  key={`${channel.connectedAt}-${index}`}
                >
                  <span className={styles.dotOnline} />
                  <Text style={{ fontSize: 12 }} type={'secondary'}>
                    {channel.channel ? `${channel.channel} · ` : ''}
                    {t('devices.channel.connected', { time: dayjs(channel.connectedAt).fromNow() })}
                  </Text>
                </Flexbox>
              ))
            ) : (
              <Flexbox horizontal align={'center'} gap={6}>
                <span className={styles.dotOffline} />
                <Text style={{ fontSize: 12 }} type={'secondary'}>
                  {t('devices.status.offline')} ·{' '}
                  {t('devices.lastSeen', { time: dayjs(device.lastSeen).fromNow() })}
                </Text>
              </Flexbox>
            )}
          </Flexbox>
        </Flexbox>
        <DropdownMenu
          items={[
            {
              icon: <Icon icon={PencilLineIcon} />,
              key: 'edit',
              label: t('devices.actions.edit'),
              onClick: openEdit,
            },
            { type: 'divider' },
            {
              danger: true,
              icon: <Icon icon={Trash2Icon} />,
              key: 'remove',
              label: t('devices.actions.remove'),
              onClick: handleRemove,
            },
          ]}
        >
          <ActionIcon icon={MoreVerticalIcon} />
        </DropdownMenu>
      </Flexbox>
      <Modal
        cancelText={t('devices.edit.cancel')}
        confirmLoading={updateDevice.isPending}
        okText={t('devices.edit.save')}
        open={editOpen}
        title={t('devices.edit.title')}
        width={440}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
      >
        <Flexbox gap={16} paddingBlock={8}>
          <Flexbox gap={6}>
            <Text weight={500}>{t('devices.edit.friendlyName')}</Text>
            <Input
              placeholder={t('devices.edit.friendlyNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Text weight={500}>{t('devices.edit.defaultCwd')}</Text>
            <Input
              placeholder={t('devices.edit.defaultCwdPlaceholder')}
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      </Modal>
    </>
  );
});

DeviceItem.displayName = 'DeviceItem';

export default DeviceItem;
