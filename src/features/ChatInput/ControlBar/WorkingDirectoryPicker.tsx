'use client';

import { isDesktop } from '@lobechat/const';
import type { WorkingDirEntry } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';
import { Flexbox, Icon, Input, Popover, Tooltip } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openAddWorkingDirModal } from '@/features/WorkingDirectory';
import {
  resolveAgentWorkingDirectory,
  resolveTargetDeviceId,
} from '@/helpers/agentWorkingDirectory';
import { deviceService } from '@/services/device';
import { electronSystemService } from '@/services/electron/system';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import DirIcon from './DirIcon';
import { useCommitWorkingDirectory } from './useCommitWorkingDirectory';
import { useMigrateDeviceRecents } from './useMigrateDeviceRecents';

// Show the in-place search box only once the list is long enough that scanning
// gets tedious — a short list doesn't need the extra chrome.
const SEARCH_THRESHOLD = 8;

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    flex: none;

    padding-inline: 5px;
    border-radius: 999px;

    font-size: 10px;
    line-height: 15px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillSecondary};
  `,
  button: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  buttonLabel: css`
    overflow: hidden;
    max-width: 140px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  chooseFolderItem: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    transition: background-color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  clearText: css`
    cursor: pointer;

    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  dirItem: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    /* Reveal the row actions (set-default / remove) only on hover. */
    &:hover .wd-row-actions {
      display: flex;
    }
  `,
  dirItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  dirName: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  dirPath: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowAction: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextQuaternary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rowActions: css`
    display: none;
    flex: none;
    gap: 2px;
    align-items: center;
  `,
  scrollContainer: css`
    overflow-y: auto;
    max-height: 320px;
  `,
  searchBar: css`
    padding-block: 2px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    .ant-input-affix-wrapper {
      padding-inline: 0;
    }

    .ant-input-prefix {
      margin-inline-end: 8px;
    }
  `,
  sectionTitle: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

type FolderEntry = { path: string; repoType?: 'git' | 'github' };

/** This machine: browse the filesystem via the native Electron folder dialog. */
const ChooseLocalFolderRow = memo<{ defaultPath?: string; onPick: (entry: FolderEntry) => void }>(
  ({ defaultPath, onPick }) => {
    const { t } = useTranslation('device');
    const handleClick = async () => {
      const result = await electronSystemService.selectFolder({
        defaultPath: defaultPath || undefined,
        title: t('workingDirectory.selectFolder'),
      });
      if (result) onPick({ path: result.path, repoType: result.repoType });
    };
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.chooseFolderItem}
        gap={8}
        onClick={handleClick}
      >
        <Icon icon={FolderOpenIcon} size={14} />
        <span>{t('workingDirectory.chooseDifferentFolder')}</span>
      </Flexbox>
    );
  },
);
ChooseLocalFolderRow.displayName = 'ChooseLocalFolderRow';

/** Web / remote device: filesystem isn't browsable here — enter an absolute path. */
const AddRemoteFolderRow = memo<{
  defaultCwd?: string;
  deviceId?: string;
  onBeforeOpen: () => void;
  onPick: (entry: FolderEntry) => void;
}>(({ defaultCwd, deviceId, onBeforeOpen, onPick }) => {
  const { t } = useTranslation('device');

  // Stat the entered path on the target device (it can't be browsed here): block
  // on a definitive negative, otherwise commit with the detected repoType so the
  // recent entry shows the right (git / github) icon. An unreachable device
  // (null) is treated as "can't verify" and allowed through without a repoType.
  const handleSubmit = async (path: string): Promise<string | undefined> => {
    const result = deviceId ? await deviceService.statPath(deviceId, path) : undefined;
    if (result) {
      if (!result.exists) return t('workingDirectory.pathNotExist');
      if (!result.isDirectory) return t('workingDirectory.pathNotDirectory');
    }
    onPick({ path, repoType: result?.repoType });
    return undefined;
  };

  const handleClick = () => {
    onBeforeOpen();
    openAddWorkingDirModal({ onSubmit: handleSubmit, placeholder: defaultCwd || undefined });
  };
  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.chooseFolderItem}
      gap={8}
      onClick={handleClick}
    >
      <Icon icon={FolderPlusIcon} size={14} />
      <span>{t('workingDirectory.addFolder')}</span>
    </Flexbox>
  );
});
AddRemoteFolderRow.displayName = 'AddRemoteFolderRow';

interface WorkingDirectoryPickerProps {
  agentId: string;
}

/**
 * Unified working-directory picker for both local and remote runs. Recents come
 * from the target device's `device.workingDirs`; picks write through the unified
 * `useCommitWorkingDirectory` (topic override / agent per-device choice). When
 * the target is this machine, the native folder dialog is offered; a true remote
 * device falls back to manual path entry (its filesystem isn't browsable here).
 *
 * The device-wide **default** directory (`device.defaultCwd`) is surfaced
 * explicitly — the row carrying it wears a "default" badge, and any row can be
 * promoted to the default from its hover actions — so the fallback the agent
 * runs in when nothing is picked is never invisible.
 */
const WorkingDirectoryPicker = memo<WorkingDirectoryPickerProps>(({ agentId }) => {
  const { t } = useTranslation('device');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const activeRowRef = useRef<HTMLDivElement>(null);

  // Populate the device store (SWR dedupes across callers). Devices sit behind an
  // authed lambda procedure, so only fetch once signed in (desktop always fetches).
  const isLogin = useUserStore(authSelectors.isLogin);
  useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);
  // One-time fold of legacy localStorage recents into device.workingDirs.
  useMigrateDeviceRecents();

  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  // The local machine's filesystem is browsable; a remote device's is not.
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const recents = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const deviceDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(targetDeviceId));
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const topicWorkingDirectoryConfig = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.workingDirectoryConfig,
  );
  const legacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );

  // The explicitly-selected cwd (no home fallback) — drives the active check and
  // the Reset affordance.
  const selectedDir = resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
  });

  // Reset only makes sense when an agent-level override exists. The device-wide
  // `deviceDefaultCwd` isn't clearable from here (it's the fallback itself), so
  // gating on it would render a dead button when the cwd comes from the default.
  const agentChoice = targetDeviceId
    ? agencyConfig?.workingDirByDevice?.[targetDeviceId]
    : undefined;
  const hasClearableSelection = !!(
    topicWorkingDirectory ||
    agentChoice ||
    legacyAgentWorkingDirectory
  );

  const { clear, commit } = useCommitWorkingDirectory(agentId);
  const removeDeviceWorkingDir = useDeviceStore((s) => s.removeDeviceWorkingDir);
  const updateDeviceCwd = useDeviceStore((s) => s.updateDeviceCwd);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return recents;
    return recents.filter(
      (entry) =>
        getDirName(entry.path).toLowerCase().includes(query) ||
        entry.path.toLowerCase().includes(query),
    );
  }, [recents, search]);

  const showSearch = recents.length > SEARCH_THRESHOLD;

  // Reset the query each time the picker closes.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  // Scroll the current selection into view every time the picker opens — the
  // popover re-mounts its list at scrollTop=0, so a selected dir below the fold
  // would otherwise read as "nothing selected". Re-run when the filtered rows
  // change (search) so the active row, if still present, stays visible.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, filtered.length]);

  const pick = async (entry: WorkingDirEntry) => {
    await commit(entry);
    setOpen(false);
  };

  const handleRemoveRecent = (e: React.MouseEvent, entry: WorkingDirEntry) => {
    e.stopPropagation();
    if (!targetDeviceId) return;
    // Both remove and the undo re-add persist the *whole* `workingDirs` array, so
    // an undo fired before the remove settles would race it — a late-finishing
    // remove would clobber the re-added entry and the undo would silently fail.
    // Chain the undo behind the remove promise so the re-add always writes last.
    const removed = removeDeviceWorkingDir(targetDeviceId, entry.path);
    toast.success({
      actions: [
        {
          label: t('workingDirectory.undo'),
          onClick: () =>
            void removed.then(() => updateDeviceCwd(targetDeviceId, entry, { setDefault: false })),
          variant: 'text',
        },
      ],
      title: t('workingDirectory.removed', { name: getDirName(entry.path) }),
    });
  };

  const handleSetDefault = (e: React.MouseEvent, entry: WorkingDirEntry) => {
    e.stopPropagation();
    if (targetDeviceId) void updateDeviceCwd(targetDeviceId, entry, { setDefault: true });
  };

  const renderRow = (entry: WorkingDirEntry) => {
    const effectivePath = getWorkingDirEffectivePath(entry);
    const isActive = effectivePath === selectedDir;
    const isDefault = !!deviceDefaultCwd && effectivePath === deviceDefaultCwd;
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.dirItem, isActive && styles.dirItemActive)}
        gap={8}
        key={entry.path}
        ref={isActive ? activeRowRef : undefined}
        onClick={() => void pick(entry)}
      >
        <DirIcon repoType={entry.repoType} />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={6}>
            <div className={styles.dirName}>{getDirName(entry.path)}</div>
            {isDefault && (
              <span className={styles.badge}>{t('workingDirectory.defaultBadge')}</span>
            )}
          </Flexbox>
          <div className={styles.dirPath}>{entry.path}</div>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={2} style={{ flex: 'none' }}>
          {/* Set-as-default is offered on every non-default row — including the
              active one (promoting the dir you're currently using to the device
              default is the common case). Remove (X) is hidden on the active row:
              you can't remove the selection out from under yourself. */}
          <div className={cx('wd-row-actions', styles.rowActions)}>
            {!isDefault && (
              <Tooltip title={t('workingDirectory.setDefault')}>
                <div className={styles.rowAction} onClick={(e) => handleSetDefault(e, entry)}>
                  <Icon icon={StarIcon} size={13} />
                </div>
              </Tooltip>
            )}
            {!isActive && (
              <Tooltip title={t('workingDirectory.removeRecent')}>
                <div className={styles.rowAction} onClick={(e) => handleRemoveRecent(e, entry)}>
                  <Icon icon={XIcon} size={12} />
                </div>
              </Tooltip>
            )}
          </div>
          {isActive && (
            <Icon icon={CheckIcon} size={16} style={{ color: cssVar.colorSuccess, flex: 'none' }} />
          )}
        </Flexbox>
      </Flexbox>
    );
  };

  const content = (
    <Flexbox gap={4} style={{ maxWidth: 'calc(100vw - 48px)', width: 320 }}>
      {showSearch && (
        <div className={styles.searchBar}>
          <Input
            autoFocus
            placeholder={t('workingDirectory.searchPlaceholder')}
            prefix={<Icon icon={SearchIcon} size={14} />}
            size="small"
            value={search}
            variant="borderless"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <Flexbox horizontal align={'center'} distribution={'space-between'}>
        <div className={styles.sectionTitle}>{t('workingDirectory.recent')}</div>
        {hasClearableSelection && (
          <div className={styles.clearText} onClick={() => void clear().then(() => setOpen(false))}>
            {t('workingDirectory.clear')}
          </div>
        )}
      </Flexbox>
      <div className={styles.scrollContainer}>
        {filtered.length === 0 ? (
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{ color: cssVar.colorTextQuaternary, fontSize: 12, padding: '12px 8px' }}
          >
            {search.trim() ? t('workingDirectory.noMatch') : t('workingDirectory.noRecent')}
          </Flexbox>
        ) : (
          filtered.map(renderRow)
        )}
      </div>

      {isLocalDevice ? (
        <ChooseLocalFolderRow defaultPath={selectedDir} onPick={pick} />
      ) : (
        <AddRemoteFolderRow
          defaultCwd={deviceDefaultCwd}
          deviceId={targetDeviceId}
          onBeforeOpen={() => setOpen(false)}
          onPick={pick}
        />
      )}
    </Flexbox>
  );

  const displayName = selectedDir ? getDirName(selectedDir) : t('workingDirectory.notSet');

  const trigger = (
    <div className={styles.button}>
      {selectedDir ? (
        <DirIcon repoType={recents.find((r) => r.path === selectedDir)?.repoType} />
      ) : (
        <Icon icon={FolderIcon} size={14} />
      )}
      <span className={styles.buttonLabel}>{displayName}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  return (
    <Popover
      content={content}
      open={open}
      placement="bottomLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div>
        {open ? (
          trigger
        ) : (
          <Tooltip title={selectedDir || t('workingDirectory.notSet')}>{trigger}</Tooltip>
        )}
      </div>
    </Popover>
  );
});

WorkingDirectoryPicker.displayName = 'WorkingDirectoryPicker';

export default WorkingDirectoryPicker;
