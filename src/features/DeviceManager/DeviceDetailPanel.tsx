'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceListItem, DeviceWorkspaceShare } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Icon, Input, SortableList, Tag, Text } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { FolderOpenIcon, FolderPlusIcon, LockIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { openAddWorkingDirModal } from '@/features/WorkingDirectory';
import { createWorkspaceLambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { deviceService } from '@/services/device';
import { electronSystemService } from '@/services/electron/system';
import { nextWorkingDirs } from '@/store/device';

import { refreshDeviceList } from './const';
import { getDeviceIcon } from './getDeviceIcon';
import { useCanEditDevice } from './useCanEditDevice';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block: 16px;
    padding-inline: 20px;
  `,
  dot: css`
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  header: css`
    padding-block-end: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  iconTile: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  path: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  recentItem: css`
    padding-block: 8px;
    padding-inline: 8px;
  `,
}));

// Section label — one consistent treatment for every field heading in the panel.
const FieldLabel = memo<{ children: ReactNode; extra?: ReactNode }>(({ children, extra }) => (
  <Flexbox horizontal align={'center'} distribution={'space-between'}>
    <Text fontSize={12} type={'secondary'} weight={500}>
      {children}
    </Text>
    {extra}
  </Flexbox>
));

interface DeviceDetailPanelProps {
  device: DeviceListItem;
  isCurrent?: boolean;
  onClose: () => void;
}

const DeviceDetailPanel = memo<DeviceDetailPanelProps>(({ device, isCurrent, onClose }) => {
  const { t } = useTranslation(['setting', 'device']);
  const canEdit = useCanEditDevice()(device);

  const [name, setName] = useState(device.friendlyName ?? '');
  const [cwd, setCwd] = useState(device.defaultCwd ?? '');

  // Workspace devices commit via the self-or-owner-gated, workspace-scoped
  // mutation; personal devices stay userId-scoped. Route by the device's own
  // scope.
  const onUpdateSuccess = () => refreshDeviceList();
  const updatePersonal = lambdaQuery.device.updateDevice.useMutation({
    onSuccess: onUpdateSuccess,
  });
  const updateWorkspace = lambdaQuery.device.updateWorkspaceDevice.useMutation({
    onSuccess: onUpdateSuccess,
  });
  const update = device.scope === 'workspace' ? updateWorkspace : updatePersonal;

  // Only the machine you're on can browse its own filesystem natively.
  const canBrowse = !!isCurrent && isDesktop;

  // Render the device's live connections straight from `device.channels` — one
  // row per connection; an empty array means offline.
  const channels = device.channels ?? [];
  const online = channels.length > 0;

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

  const addRecent = (entry: { path: string; repoType?: 'git' | 'github' }) => {
    update.mutate({
      deviceId: device.deviceId,
      workingDirs: nextWorkingDirs(entry, device.workingDirs),
    });
  };

  const handleAddRecent = async () => {
    // This machine: browse natively. A remote / non-current device isn't
    // browsable from here, so fall back to manual absolute-path entry (the same
    // modal the chat control bar uses), statting the path on the target device.
    if (canBrowse) {
      const result = await electronSystemService.selectFolder({
        title: t('devices.detail.addDir'),
      });
      if (result?.path) addRecent({ path: result.path, repoType: result.repoType });
      return;
    }

    openAddWorkingDirModal({
      onSubmit: async (path) => {
        const result = await deviceService.statPath(device.deviceId, path);
        if (result) {
          if (!result.exists) return t('device:workingDirectory.pathNotExist');
          if (!result.isDirectory) return t('device:workingDirectory.pathNotDirectory');
        }
        addRecent({ path, repoType: result?.repoType });
        return undefined;
      },
      placeholder: device.defaultCwd || undefined,
    });
  };

  const handleRemoveRecent = (path: string) => {
    update.mutate({
      deviceId: device.deviceId,
      workingDirs: device.workingDirs.filter((d) => d.path !== path),
    });
  };

  // Revoke one workspace share of a personal device (LOBE-11699). The share
  // entry's `deviceId` is the workspace-scoped twin, removed via the
  // workspace-scoped mutation under an explicitly pinned workspace client —
  // the personal settings page has no active workspace context to inherit.
  const handleRevokeShare = (share: DeviceWorkspaceShare) =>
    confirmModal({
      content: t('devices.share.revokeConfirmDesc'),
      okButtonProps: { danger: true },
      okText: t('devices.share.revoke'),
      onOk: async () => {
        try {
          await createWorkspaceLambdaClient(share.workspaceId).device.removeWorkspaceDevice.mutate({
            deviceId: share.deviceId,
          });
          refreshDeviceList();
        } catch (error) {
          message.error((error as Error).message);
          throw error;
        }
      },
      title: t('devices.share.revokeConfirmTitle', {
        name: share.workspaceName ?? share.workspaceId,
      }),
    });

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
      <Flexbox horizontal align={'center'} className={styles.header} gap={12}>
        <span className={styles.iconTile}>{getDeviceIcon(device.platform, 18)}</span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis weight={600}>
            {device.friendlyName || device.hostname || device.deviceId}
          </Text>
          <Flexbox horizontal align={'center'} gap={8}>
            <Tag color={online ? 'success' : 'default'} size={'small'}>
              {online ? t('devices.status.online') : t('devices.status.offline')}
            </Tag>
            {isCurrent && <Tag size={'small'}>{t('devices.currentBadge')}</Tag>}
          </Flexbox>
        </Flexbox>
        <ActionIcon icon={XIcon} size={'small'} onClick={onClose} />
      </Flexbox>

      {/* Visible hint when the caller can't mutate the row — explains why the
          fields below are read-only without the user needing to try and hit a
          403. Only renders for workspace devices that aren't the caller's own
          enrollment (personal scope is always editable). */}
      {!canEdit && (
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={LockIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
          <Text fontSize={12} type={'secondary'}>
            {t('workspaceSetting.devices.readonlyHint')}
          </Text>
        </Flexbox>
      )}

      {/* ─── Enrolled by (workspace only) ─── */}
      {device.scope === 'workspace' && device.enroller && (
        <Flexbox gap={8}>
          <FieldLabel>{t('workspaceSetting.devices.enrolledByLabel')}</FieldLabel>
          <Flexbox horizontal align={'center'} gap={8}>
            <Avatar avatar={device.enroller.avatar ?? undefined} size={24} />
            <Text>
              {device.enroller.fullName ||
                device.enroller.username ||
                t('workspaceSetting.devices.unknownEnroller')}
            </Text>
          </Flexbox>
        </Flexbox>
      )}

      {/* ─── Shared to workspaces (personal only) ─── */}
      {device.scope === 'personal' && !!device.sharedWorkspaces?.length && (
        <Flexbox gap={8}>
          <FieldLabel>{t('devices.share.detailLabel')}</FieldLabel>
          {device.sharedWorkspaces.map((share) => (
            <Flexbox horizontal align={'center'} gap={8} key={share.workspaceId}>
              <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                {share.workspaceName ?? share.workspaceId}
              </Text>
              <Tag size={'small'}>
                {share.visibility === 'private'
                  ? t('devices.share.visibilityTag.private')
                  : t('devices.share.visibilityTag.public')}
              </Tag>
              <ActionIcon
                icon={XIcon}
                size={'small'}
                title={t('devices.share.revoke')}
                onClick={() => handleRevokeShare(share)}
              />
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {/* ─── Connections ─── */}
      <Flexbox gap={8}>
        <FieldLabel>{t('devices.detail.connections')}</FieldLabel>
        {channels.length > 0 ? (
          channels.map((channel, index) => (
            <Flexbox horizontal align={'center'} gap={8} key={`${channel.connectedAt}-${index}`}>
              <span className={styles.dot} style={{ background: cssVar.colorSuccess }} />
              {channel.channel && <Tag size={'small'}>{channel.channel}</Tag>}
              <Text fontSize={12} type={'secondary'}>
                {t('devices.channel.connected', { time: dayjs(channel.connectedAt).fromNow() })}
              </Text>
            </Flexbox>
          ))
        ) : (
          <Flexbox horizontal align={'center'} gap={8}>
            <span className={styles.dot} style={{ background: cssVar.colorTextQuaternary }} />
            <Text fontSize={12} type={'secondary'}>
              {t('devices.status.offline')} ·{' '}
              {t('devices.lastSeen', { time: dayjs(device.lastSeen).fromNow() })}
            </Text>
          </Flexbox>
        )}
      </Flexbox>

      {/* ─── Name ─── */}
      <Flexbox gap={8}>
        <FieldLabel>{t('devices.edit.friendlyName')}</FieldLabel>
        {canEdit ? (
          <Input
            placeholder={t('devices.edit.friendlyNamePlaceholder')}
            value={name}
            onBlur={commitName}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={commitName}
          />
        ) : device.friendlyName ? (
          // Read-only: render the canonical value (not the local draft), so a
          // value the caller can't actually commit never bleeds through.
          <Text>{device.friendlyName}</Text>
        ) : (
          <Text type={'secondary'}>—</Text>
        )}
      </Flexbox>

      {/* ─── Default working directory ─── */}
      <Flexbox gap={8}>
        <FieldLabel>{t('devices.edit.defaultCwd')}</FieldLabel>
        {canEdit ? (
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
        ) : device.defaultCwd ? (
          // Code font only when there's an actual path to read; empty falls back
          // to the same dash style as Name so the two fields look consistent.
          <Text className={styles.path}>{device.defaultCwd}</Text>
        ) : (
          <Text type={'secondary'}>—</Text>
        )}
      </Flexbox>

      {/* ─── Recent directories ─── */}
      <Flexbox gap={8}>
        <FieldLabel
          extra={
            canEdit && (
              <ActionIcon
                icon={FolderPlusIcon}
                size={'small'}
                title={t('devices.detail.addDir')}
                onClick={handleAddRecent}
              />
            )
          }
        >
          {t('devices.detail.recentDirs')}
        </FieldLabel>
        {device.workingDirs.length === 0 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('devices.detail.noRecent')}
          </Text>
        ) : canEdit ? (
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
        ) : (
          // Read-only listing: same row layout minus the drag handle and the
          // remove button. Keeps the path + repo type icon visible for context.
          device.workingDirs.map((d) => (
            <Flexbox horizontal align={'center'} className={styles.recentItem} gap={8} key={d.path}>
              <DirIcon repoType={d.repoType} />
              <Text className={styles.path} title={d.path}>
                {d.path}
              </Text>
            </Flexbox>
          ))
        )}
      </Flexbox>
    </Flexbox>
  );
});

DeviceDetailPanel.displayName = 'DeviceDetailPanel';

export default DeviceDetailPanel;
