'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  CopyButton,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Input,
  SortableList,
  Tabs,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import {
  ArrowLeftIcon,
  BotIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  InfoIcon,
  LockIcon,
  PencilIcon,
  XIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { openAddWorkingDirModal } from '@/features/WorkingDirectory';
import { lambdaQuery } from '@/libs/trpc/client';
import { deviceService } from '@/services/device';
import { electronSystemService } from '@/services/electron/system';
import { nextWorkingDirs } from '@/store/device';

import AgentRuntimes from './AgentRuntimes';
import { refreshDeviceList } from './const';
import DeviceOverview from './DeviceOverview';
import FieldLabel from './FieldLabel';
import { getDeviceIcon } from './getDeviceIcon';
import { useCanEditDevice, useCanOperateDevice } from './useCanEditDevice';

const styles = createStaticStyles(({ css }) => ({
  // Presence badge on the icon tile's corner — same treatment as the card the
  // user just clicked, so the page reads as that card opened up.
  iconTile: css`
    position: relative;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: 14px;

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
  presence: css`
    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -3px;

    width: 14px;
    height: 14px;
    border: 2px solid ${cssVar.colorBgLayout};
    border-radius: 50%;
  `,
  recentItem: css`
    padding-block: 8px;
    padding-inline: 8px;
  `,
}));

const DETAIL_TABS = ['overview', 'files', 'agents'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const isDetailTab = (value: string | null): value is DetailTab =>
  !!value && (DETAIL_TABS as readonly string[]).includes(value);

interface DeviceDetailProps {
  device: DeviceListItem;
  /**
   * The row was confirmed by the server this session. A row restored from
   * storage may be stale, and edits merge into it (the full `workingDirs` list,
   * the drafts below), so it stays read-only until confirmed.
   */
  isConfirmed: boolean;
  isCurrent?: boolean;
  onBack: () => void;
}

/**
 * Full-page device detail — the second level of the device settings routes
 * (`/settings/devices/:sub`, `/:slug/settings/devices/:sub`). The list stays a
 * plain card grid and every card opens here.
 */
const DeviceDetail = memo<DeviceDetailProps>(({ device, isConfirmed, isCurrent, onBack }) => {
  const { t } = useTranslation(['setting', 'device']);
  // Permission alone drives the read-only hint; confirmation only defers edits.
  const isEditableRow = useCanEditDevice()(device);
  const canEdit = isEditableRow && isConfirmed;
  const canOperate = useCanOperateDevice()(device) && isConfirmed;
  // Health monitoring and the directory settings are separate jobs; a tab each
  // keeps the charts from pushing the directories below the fold. The active
  // tab lives in `?tab=` so a view can be linked, reloaded and reached with
  // Back; other params (the workspace `?visibility=`) are kept.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: DetailTab = isDetailTab(tabParam) ? tabParam : 'overview';
  const setTab = (next: DetailTab) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'overview') params.delete('tab');
        else params.set('tab', next);
        return params;
      },
      { replace: true },
    );

  const [name, setName] = useState(device.friendlyName ?? '');
  const [editingName, setEditingName] = useState(false);
  const [cwd, setCwd] = useState(device.defaultCwd ?? '');
  // Normalized once: every read and write below goes through this local.
  const workingDirs = device.workingDirs ?? [];

  // Workspace devices commit via the self-or-owner-gated, workspace-scoped
  // mutation; personal devices stay userId-scoped. Route by the device's own
  // scope.
  // Edits save without a Save button, so a failed write must say so — otherwise
  // the prop-backed value silently snaps back.
  const onUpdateSuccess = () => refreshDeviceList();
  const onUpdateError = (error: { message: string }) => toast.error(error.message);
  const updatePersonal = lambdaQuery.device.updateDevice.useMutation({
    onError: onUpdateError,
    onSuccess: onUpdateSuccess,
  });
  const updateWorkspace = lambdaQuery.device.updateWorkspaceDevice.useMutation({
    onError: onUpdateError,
    onSuccess: onUpdateSuccess,
  });
  const update = device.scope === 'workspace' ? updateWorkspace : updatePersonal;

  // Only the machine you're on can browse its own filesystem natively.
  const canBrowse = !!isCurrent && isDesktop;

  // An empty `device.channels` means offline — unless the row is the
  // persisted copy, whose presence the server has not confirmed yet.
  const channels = device.channels ?? [];
  const online = channels.length > 0;
  const presenceUnknown = !!device.onlineUnknown;

  // Every edit persists immediately — there is no Save button. Name and the
  // default cwd commit on blur; recent-dir add / remove / reorder commit on the
  // spot.
  // The editor closes only once the rename lands, so a failed save keeps the
  // draft on screen for another try.
  const commitName = () => {
    // Enter then blur would otherwise send the same rename twice.
    if (update.isPending) return;
    const next = name.trim() || null;
    if (next === (device.friendlyName ?? null)) {
      setEditingName(false);
      return;
    }
    update.mutate(
      { deviceId: device.deviceId, friendlyName: next },
      { onSuccess: () => setEditingName(false) },
    );
  };

  const cancelName = () => {
    setName(device.friendlyName ?? '');
    setEditingName(false);
  };

  const commitCwd = (value: string, repoType?: 'git' | 'github') => {
    const trimmed = value.trim();
    update.mutate({
      defaultCwd: trimmed || null,
      deviceId: device.deviceId,
      // Setting a default cwd also seeds the working-dirs list.
      workingDirs: trimmed
        ? nextWorkingDirs({ path: trimmed, repoType }, workingDirs)
        : workingDirs,
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
      workingDirs: nextWorkingDirs(entry, workingDirs),
    });
  };

  const handleAddRecent = async () => {
    // Browse this machine natively; other devices use the shared remote browser.
    if (canBrowse) {
      const result = await electronSystemService.selectFolder({
        title: t('devices.detail.addDir'),
      });
      if (result?.path) addRecent({ path: result.path, repoType: result.repoType });
      return;
    }

    openAddWorkingDirModal({
      defaultPath: device.defaultCwd || undefined,
      deviceId: device.deviceId,
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
      workingDirs: workingDirs.filter((d) => d.path !== path),
    });
  };

  const handleReorderRecent = (items: { id: string }[]) => {
    // SortableList items are keyed by path; map ids back to their entries so the
    // detected repoType survives a reorder.
    const byPath = new Map(workingDirs.map((d) => [d.path, d]));
    update.mutate({
      deviceId: device.deviceId,
      workingDirs: items.map((item) => byPath.get(item.id) ?? { path: item.id }),
    });
  };

  const displayName = device.friendlyName || device.hostname || device.deviceId;

  return (
    <Flexbox gap={24}>
      <Flexbox horizontal>
        <Button icon={<Icon icon={ArrowLeftIcon} />} size={'small'} type={'text'} onClick={onBack}>
          {t('devices.detail.back')}
        </Button>
      </Flexbox>

      {/* ─── Header: title (renamed in place), then the copyable device id ─── */}
      <Flexbox horizontal align={'center'} gap={16}>
        <span className={styles.iconTile}>
          {getDeviceIcon(device.platform, 26)}
          <span
            className={styles.presence}
            style={{ background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
            title={
              presenceUnknown
                ? t('devices.status.checking')
                : online
                  ? t('devices.status.onlineConnections', { count: channels.length })
                  : t('devices.status.offline')
            }
          />
        </span>
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          {editingName ? (
            <Input
              autoFocus
              placeholder={t('devices.edit.friendlyNamePlaceholder')}
              style={{ fontSize: 18, fontWeight: 600, maxWidth: 480 }}
              value={name}
              onBlur={commitName}
              onChange={(e) => setName(e.target.value)}
              onPressEnter={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelName();
              }}
            />
          ) : (
            <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
              <Text ellipsis as={'h2'} fontSize={22} style={{ margin: 0 }} weight={600}>
                {displayName}
              </Text>
              {canEdit && (
                <ActionIcon
                  aria-label={t('devices.detail.rename')}
                  icon={PencilIcon}
                  size={'small'}
                  title={t('devices.detail.rename')}
                  onClick={() => setEditingName(true)}
                />
              )}
            </Flexbox>
          )}
          <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
            <Flexbox horizontal align={'center'} gap={2} style={{ minWidth: 0 }}>
              <span className={styles.path} title={device.deviceId}>
                {device.deviceId}
              </span>
              <CopyButton content={device.deviceId} size={'small'} />
            </Flexbox>
            {isCurrent && <Tag size={'small'}>{t('devices.currentBadge')}</Tag>}
            {device.scope === 'workspace' && device.visibility === 'private' && (
              <Tag icon={<Icon icon={LockIcon} />} size={'small'}>
                {t('devices.visibilityTabs.private')}
              </Tag>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Tabs
        activeKey={tab}
        items={[
          {
            icon: <Icon icon={InfoIcon} />,
            key: 'overview',
            label: t('devices.detail.tabs.overview'),
          },
          {
            icon: <Icon icon={FolderIcon} />,
            key: 'files',
            label: t('devices.detail.tabs.files'),
          },
          {
            icon: <Icon icon={BotIcon} />,
            key: 'agents',
            label: t('devices.detail.tabs.agents'),
          },
        ]}
        onChange={(key) => setTab(key as DetailTab)}
      />

      <Flexbox gap={20}>
        {/* Visible hint when the caller can't mutate the row — explains why the
            fields below are read-only without the user needing to try and hit a
            403. Only renders for workspace devices that aren't the caller's own
            enrollment (personal scope is always editable). */}
        {!isEditableRow && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={LockIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
            <Text fontSize={12} type={'secondary'}>
              {t('workspaceSetting.devices.readonlyHint')}
            </Text>
          </Flexbox>
        )}

        {tab === 'overview' && <DeviceOverview canOperate={canOperate} device={device} />}

        {tab === 'agents' && <AgentRuntimes device={device} />}

        {tab === 'files' && (
          <>
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
              {workingDirs.length === 0 ? (
                <Text fontSize={12} type={'secondary'}>
                  {t('devices.detail.noRecent')}
                </Text>
              ) : canEdit ? (
                <SortableList
                  items={workingDirs.map((d) => ({ id: d.path, repoType: d.repoType }))}
                  renderItem={(item: { id: string; repoType?: 'git' | 'github' }) => (
                    <SortableList.Item
                      className={styles.recentItem}
                      id={item.id}
                      variant={'filled'}
                    >
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
                workingDirs.map((d) => (
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={styles.recentItem}
                    gap={8}
                    key={d.path}
                  >
                    <DirIcon repoType={d.repoType} />
                    <Text className={styles.path} title={d.path}>
                      {d.path}
                    </Text>
                  </Flexbox>
                ))
              )}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

DeviceDetail.displayName = 'DeviceDetail';

export default DeviceDetail;
