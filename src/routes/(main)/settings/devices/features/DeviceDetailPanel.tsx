'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon, Button, Flexbox, Icon, Input, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { FolderOpenIcon, XIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { nextRecentCwds } from '@/features/ChatInput/RuntimeConfig/deviceCwd';
import { lambdaQuery } from '@/libs/trpc/client';
import { electronSystemService } from '@/services/electron/system';

import type { DeviceListItem } from './DeviceItem';
import { getDeviceIcon } from './getDeviceIcon';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block: 16px;
    padding-inline: 20px;
  `,
  dot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
  `,
  header: css`
    padding-block-end: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  path: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  recentRow: css`
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  removeBtn: css`
    cursor: pointer;
    flex: none;
    color: ${cssVar.colorTextQuaternary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

interface DeviceDetailPanelProps {
  device: DeviceListItem;
  isCurrent?: boolean;
  onClose: () => void;
}

const DeviceDetailPanel = memo<DeviceDetailPanelProps>(({ device, isCurrent, onClose }) => {
  const { t } = useTranslation('setting');
  const utils = lambdaQuery.useUtils();

  const [name, setName] = useState(device.friendlyName ?? '');
  const [cwd, setCwd] = useState(device.defaultCwd ?? '');

  const update = lambdaQuery.device.updateDevice.useMutation({
    onSuccess: () => utils.device.listDevices.invalidate(),
  });

  // Only the machine you're on can browse its own filesystem natively.
  const canBrowse = !!isCurrent && isDesktop;

  // Render the device's live connections straight from `device.channels` — one
  // row per connection; an empty array means offline.
  const channels = device.channels ?? [];

  const isDirty = name !== (device.friendlyName ?? '') || cwd !== (device.defaultCwd ?? '');

  const handleSave = async () => {
    const trimmed = cwd.trim();
    await update.mutateAsync({
      defaultCwd: trimmed || null,
      deviceId: device.deviceId,
      friendlyName: name.trim() || null,
      // Setting a default cwd also seeds the recent list.
      recentCwds: trimmed ? nextRecentCwds(trimmed, device.recentCwds) : device.recentCwds,
    });
  };

  const handleBrowse = async () => {
    const result = await electronSystemService.selectFolder({
      defaultPath: cwd.trim() || undefined,
      title: t('devices.edit.defaultCwd'),
    });
    if (result?.path) setCwd(result.path);
  };

  const handleRemoveRecent = (path: string) => {
    update.mutate({
      deviceId: device.deviceId,
      recentCwds: device.recentCwds.filter((p) => p !== path),
    });
  };

  return (
    <Flexbox className={styles.container} gap={20}>
      {/* ─── Header ─── */}
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        {getDeviceIcon(device.platform)}
        <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={600}>
          {device.friendlyName || device.hostname || device.deviceId}
        </Text>
        {isCurrent && <Tag>{t('devices.currentBadge')}</Tag>}
        <ActionIcon icon={XIcon} size={'small'} onClick={onClose} />
      </Flexbox>

      {/* ─── Connections ─── */}
      <Flexbox gap={8}>
        <span className={styles.label}>{t('devices.detail.connections')}</span>
        {channels.length > 0 ? (
          channels.map((channel, index) => (
            <Flexbox horizontal align={'center'} gap={8} key={`${channel.connectedAt}-${index}`}>
              <span
                className={styles.dot}
                style={{ background: cssVar.colorSuccess, flex: 'none' }}
              />
              {channel.channel && <Tag size={'small'}>{channel.channel}</Tag>}
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                {t('devices.channel.connected', { time: dayjs(channel.connectedAt).fromNow() })}
              </Text>
            </Flexbox>
          ))
        ) : (
          <Flexbox horizontal align={'center'} gap={8}>
            <span
              className={styles.dot}
              style={{ background: cssVar.colorTextQuaternary, flex: 'none' }}
            />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('devices.status.offline')} ·{' '}
              {t('devices.lastSeen', { time: dayjs(device.lastSeen).fromNow() })}
            </Text>
          </Flexbox>
        )}
      </Flexbox>

      {/* ─── Name ─── */}
      <Flexbox gap={6}>
        <span className={styles.label}>{t('devices.edit.friendlyName')}</span>
        <Input
          placeholder={t('devices.edit.friendlyNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Flexbox>

      {/* ─── Default working directory ─── */}
      <Flexbox gap={6}>
        <span className={styles.label}>{t('devices.edit.defaultCwd')}</span>
        <Flexbox horizontal gap={8}>
          <Input
            placeholder={t('devices.edit.defaultCwdPlaceholder')}
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          {canBrowse && (
            <Button icon={<Icon icon={FolderOpenIcon} />} onClick={handleBrowse}>
              {t('devices.edit.browse')}
            </Button>
          )}
        </Flexbox>
      </Flexbox>

      {/* ─── Recent directories ─── */}
      <Flexbox gap={6}>
        <span className={styles.label}>{t('devices.detail.recentDirs')}</span>
        {device.recentCwds.length === 0 ? (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('devices.detail.noRecent')}
          </Text>
        ) : (
          device.recentCwds.map((path) => (
            <Flexbox horizontal align={'center'} className={styles.recentRow} gap={8} key={path}>
              <Text
                className={styles.path}
                style={{ color: cssVar.colorTextSecondary, cursor: 'pointer', flex: 1 }}
                onClick={() => setCwd(path)}
              >
                {path}
              </Text>
              <Icon
                className={styles.removeBtn}
                icon={XIcon}
                size={14}
                onClick={() => handleRemoveRecent(path)}
              />
            </Flexbox>
          ))
        )}
      </Flexbox>

      {/* ─── Save ─── */}
      {isDirty && (
        <Flexbox horizontal justify={'flex-end'}>
          <Button loading={update.isPending} type={'primary'} onClick={handleSave}>
            {t('devices.edit.save')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

DeviceDetailPanel.displayName = 'DeviceDetailPanel';

export default DeviceDetailPanel;
