'use client';

import type { DeviceListItem } from '@lobechat/types';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { FolderIcon, MoreVerticalIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

import { refreshDeviceList } from './const';
import { getDeviceIcon } from './getDeviceIcon';

const styles = createStaticStyles(({ css }) => ({
  action: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
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
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;

    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface DeviceItemProps {
  device: DeviceListItem;
  isCurrent?: boolean;
  onSelect: () => void;
  selected?: boolean;
}

const DeviceItem = memo<DeviceItemProps>(({ device, isCurrent, onSelect, selected }) => {
  const { t } = useTranslation('setting');

  // Workspace devices are owner-gated + workspace-scoped on the server; personal
  // devices stay userId-scoped. Route by the device's own scope.
  const onRemoveSuccess = () => refreshDeviceList();
  const removePersonal = lambdaQuery.device.removeDevice.useMutation({
    onSuccess: onRemoveSuccess,
  });
  const removeWorkspace = lambdaQuery.device.removeWorkspaceDevice.useMutation({
    onSuccess: onRemoveSuccess,
  });
  const removeDevice = device.scope === 'workspace' ? removeWorkspace : removePersonal;

  const displayName = device.friendlyName || device.hostname || device.deviceId;
  const isFallback = device.identitySource === 'fallback';
  // Online when the device has at least one live connection in `device.channels`.
  const channels = device.channels ?? [];
  const online = channels.length > 0;
  const statusTooltip = online
    ? t('devices.channel.connected', {
        time: dayjs(channels[0]?.connectedAt ?? device.lastSeen).fromNow(),
      })
    : t('devices.lastSeen', { time: dayjs(device.lastSeen).fromNow() });

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
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.row, selected && styles.rowActive)}
      gap={12}
      onClick={onSelect}
    >
      <span className={styles.icon}>{getDeviceIcon(device.platform)}</span>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text ellipsis weight={500}>
            {displayName}
          </Text>
          <Tooltip title={statusTooltip}>
            <span className={online ? styles.dotOnline : styles.dotOffline} />
          </Tooltip>
          {isCurrent && <Tag>{t('devices.currentBadge')}</Tag>}
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
      </Flexbox>
      <span className={styles.action} onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          items={[
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
      </span>
    </Flexbox>
  );
});

DeviceItem.displayName = 'DeviceItem';

export default DeviceItem;
