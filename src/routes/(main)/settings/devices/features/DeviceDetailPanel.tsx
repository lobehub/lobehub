'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Icon, Input, SortableList, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { FolderOpenIcon, FolderPlusIcon, XIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { lambdaQuery } from '@/libs/trpc/client';
import { electronSystemService } from '@/services/electron/system';
import { nextWorkingDirs } from '@/store/device';

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
    flex: 1;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  recentItem: css`
    padding-block: 6px;
    padding-inline: 8px;
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

  // Every edit persists immediately — there is no Save button. Name and the
  // default cwd commit on blur; recent-dir add / remove / reorder commit on the
  // spot.
  const commitName = () => {
    const next = name.trim() || null;
    if (next === (device.friendlyName ?? null)) return;
    update.mutate({ deviceId: device.deviceId, friendlyName: next });
  };

  const commitCwd = (value: string, repoType?: 'git' | 'github') => {
    const trimmed = value.trim();
    update.mutate({
      defaultCwd: trimmed || null,
      deviceId: device.deviceId,
      // Setting a default cwd also seeds the working-dirs list.
      workingDirs: trimmed
        ? nextWorkingDirs({ path: trimmed, repoType }, device.workingDirs)
        : device.workingDirs,
    });
  };

  const handleCwdBlur = () => {
    if (cwd.trim() === (device.defaultCwd ?? '')) return;
    commitCwd(cwd);
  };

  const handleBrowse = async () => {
    const result = await electronSystemService.selectFolder({
      defaultPath: cwd.trim() || undefined,
      title: t('devices.edit.defaultCwd'),
    });
    if (result?.path) {
      setCwd(result.path);
      commitCwd(result.path, result.repoType);
    }
  };

  const handleAddRecent = async () => {
    const result = await electronSystemService.selectFolder({
      title: t('devices.detail.addDir'),
    });
    if (result?.path) {
      update.mutate({
        deviceId: device.deviceId,
        workingDirs: nextWorkingDirs(
          { path: result.path, repoType: result.repoType },
          device.workingDirs,
        ),
      });
    }
  };

  const handleRemoveRecent = (path: string) => {
    update.mutate({
      deviceId: device.deviceId,
      workingDirs: device.workingDirs.filter((d) => d.path !== path),
    });
  };

  const handleReorderRecent = (items: { id: string }[]) => {
    // SortableList items are keyed by path; map ids back to their entries so the
    // detected repoType survives a reorder.
    const byPath = new Map(device.workingDirs.map((d) => [d.path, d]));
    update.mutate({
      deviceId: device.deviceId,
      workingDirs: items.map((item) => byPath.get(item.id) ?? { path: item.id }),
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
          onBlur={commitName}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={commitName}
        />
      </Flexbox>

      {/* ─── Default working directory ─── */}
      <Flexbox gap={6}>
        <span className={styles.label}>{t('devices.edit.defaultCwd')}</span>
        <Flexbox horizontal gap={8}>
          <Input
            placeholder={t('devices.edit.defaultCwdPlaceholder')}
            value={cwd}
            onBlur={handleCwdBlur}
            onChange={(e) => setCwd(e.target.value)}
            onPressEnter={handleCwdBlur}
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
        {device.workingDirs.length === 0 ? (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('devices.detail.noRecent')}
          </Text>
        ) : (
          <SortableList
            items={device.workingDirs.map((d) => ({ id: d.path, repoType: d.repoType }))}
            renderItem={(item: { id: string; repoType?: 'git' | 'github' }) => (
              <SortableList.Item className={styles.recentItem} id={item.id} variant={'filled'}>
                <SortableList.DragHandle />
                <DirIcon repoType={item.repoType} />
                <Text className={styles.path} title={item.id}>
                  {item.id}
                </Text>
                <ActionIcon
                  icon={XIcon}
                  size={'small'}
                  onClick={() => handleRemoveRecent(item.id)}
                />
              </SortableList.Item>
            )}
            onChange={handleReorderRecent}
          />
        )}
        {canBrowse && (
          <Button
            block
            icon={<Icon icon={FolderPlusIcon} />}
            variant={'filled'}
            onClick={handleAddRecent}
          >
            {t('devices.detail.addDir')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

DeviceDetailPanel.displayName = 'DeviceDetailPanel';

export default DeviceDetailPanel;
