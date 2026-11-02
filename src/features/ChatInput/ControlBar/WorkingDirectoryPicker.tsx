'use client';

import { isDesktop } from '@lobechat/const';
import type { WorkingDirEntry } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Input, Popover, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CheckIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openPickWorkingDirModal } from '@/features/WorkingDirectory';
import {
  resolveAgentWorkingDirectorySource,
  resolveTargetDeviceId,
} from '@/helpers/agentWorkingDirectory';
import {
  getWorkingDirectoryName,
  getWorkingDirectoryPathString,
} from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { electronSystemService } from '@/services/electron/system';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import DashedFolderIcon from './DashedFolderIcon';
import DirIcon from './DirIcon';
import { useCommitWorkingDirectory } from './useCommitWorkingDirectory';
import { useMigrateDeviceRecents } from './useMigrateDeviceRecents';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

// Show the in-place search box only once the list is long enough that scanning
// gets tedious — a short list doesn't need the extra chrome.
const SEARCH_THRESHOLD = 8;

const styles = stylex.create({
  badge: {
    flex: 'none',
    paddingInline: '5px',
    borderRadius: '999px',
    fontSize: '10px',
    lineHeight: '15px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  chooseFolderItem: {
    cursor: 'pointer',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  clearText: {
    cursor: 'pointer',
    paddingBlockStart: '6px',
    paddingBlockEnd: '2px',
    paddingInline: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'color 0.2s',
  },
  dirItem: {
    cursor: 'pointer',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  dirItemActive: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
  dirName: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dirPath: {
    overflow: 'hidden',
    fontSize: '11px',
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Reveal the row actions (set-default / remove) only on hover of the row
  // (the `defaultMarker` on `dirItem`).
  rowActions: {
    display: { default: 'none', [stylex.when.ancestor(':hover')]: 'flex' },
    flex: 'none',
    gap: '2px',
    alignItems: 'center',
  },
  scrollContainer: { overflowY: 'auto', maxHeight: '320px' },
  searchBar: {
    paddingBlock: '2px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSplit,
  },
  sectionTitle: {
    paddingBlockStart: '6px',
    paddingBlockEnd: '2px',
    paddingInline: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextQuaternary,
  },
});

const isValidWorkingDirEntry = (entry: WorkingDirEntry): boolean =>
  !!getWorkingDirectoryPathString(entry.path);

type FolderEntry = { environmentId?: string; path: string; repoType?: 'git' | 'github' };

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
        className={stylex.props(styles.chooseFolderItem).className}
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

/** Browse the target device through its directory RPC. */
const AddRemoteFolderRow = memo<{
  defaultCwd?: string;
  deviceId?: string;
  onBeforeOpen: () => void;
  onPick: (entry: FolderEntry) => void;
}>(({ defaultCwd, deviceId, onBeforeOpen, onPick }) => {
  const { t } = useTranslation('device');

  const handleClick = () => {
    onBeforeOpen();
    // A folder picked on a device may go with a code environment. Only the
    // association is kept — nothing clones or sets up on the device.
    openPickWorkingDirModal({
      defaultPath: defaultCwd || undefined,
      deviceId,
      onPick,
      withEnvironment: true,
    });
  };
  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.chooseFolderItem).className}
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
  const topicId = useTopicId();
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

  // Effective config (shared row + this member's device override)
  // so recents / default cwd / the selected-repo label all resolve against the
  // device THIS member's run actually targets.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  // The local machine's filesystem is browsable; a remote device's is not.
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const rawRecents = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const recents = useMemo(() => rawRecents.filter(isValidWorkingDirEntry), [rawRecents]);
  const rawDeviceDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(targetDeviceId));
  const deviceDefaultCwd = getWorkingDirectoryPathString(rawDeviceDefaultCwd);
  const rawTopicWorkingDirectory = useChatStore(topicSelectors.getTopicWorkingDirectory(topicId));
  const topicWorkingDirectory = getWorkingDirectoryPathString(rawTopicWorkingDirectory);
  const topicWorkingDirectoryConfig = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.workingDirectoryConfig : undefined,
  );
  const rawLegacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );
  const legacyAgentWorkingDirectory = getWorkingDirectoryPathString(rawLegacyAgentWorkingDirectory);

  // The explicitly-selected REPO (no home fallback) — drives the directory label,
  // the active check, and the Reset affordance. Resolves to the SOURCE path
  // (repo root), never the active worktree: the label shows the repo the agent is
  // bound to, while the worktree switcher in git status tracks the active
  // worktree separately.
  const resolvedSelectedDir = resolveAgentWorkingDirectorySource({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
    workspaceScoped,
  });
  const selectedDir = getWorkingDirectoryPathString(resolvedSelectedDir);

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

  const { clear, commit } = useCommitWorkingDirectory(agentId, topicId);
  const clearDeviceDefaultCwd = useDeviceStore((s) => s.clearDeviceDefaultCwd);
  const removeDeviceWorkingDir = useDeviceStore((s) => s.removeDeviceWorkingDir);
  const updateDeviceCwd = useDeviceStore((s) => s.updateDeviceCwd);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return recents;
    return recents.filter(
      (entry) =>
        getWorkingDirectoryName(entry.path)?.toLowerCase().includes(query) ||
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
      title: t('workingDirectory.removed', {
        name: getWorkingDirectoryName(entry.path) ?? entry.path,
      }),
    });
  };

  const handleToggleDefault = async (
    e: React.MouseEvent,
    entry: WorkingDirEntry,
    isDefault: boolean,
  ) => {
    e.stopPropagation();
    if (!targetDeviceId) return;

    try {
      if (isDefault) await clearDeviceDefaultCwd(targetDeviceId);
      else await updateDeviceCwd(targetDeviceId, entry, { setDefault: true });
    } catch {
      toast.error(t('workingDirectory.defaultUpdateFailed'));
    }
  };

  const renderRow = (entry: WorkingDirEntry) => {
    const sourcePath = getWorkingDirSourcePath(entry);
    const isActive = sourcePath === selectedDir;
    const isDefault = !!deviceDefaultCwd && sourcePath === deviceDefaultCwd;
    const defaultActionLabel = t(
      isDefault ? 'workingDirectory.clearDefault' : 'workingDirectory.setDefault',
    );
    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        key={entry.path}
        ref={isActive ? activeRowRef : undefined}
        className={
          stylex.props(stylex.defaultMarker(), styles.dirItem, isActive && styles.dirItemActive)
            .className
        }
        onClick={() => void pick(entry)}
      >
        <DirIcon repoType={entry.repoType} />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={6}>
            <div {...stylex.props(styles.dirName)}>
              {getWorkingDirectoryName(entry.path) ?? entry.path}
            </div>
            {isDefault && (
              <span {...stylex.props(styles.badge)}>{t('workingDirectory.defaultBadge')}</span>
            )}
          </Flexbox>
          <div {...stylex.props(styles.dirPath)}>{entry.path}</div>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={2} style={{ flex: 'none' }}>
          {/* The same Star toggles the device default in both directions. Remove
              (X) is hidden on the active row: you can't remove the selection out
              from under yourself. */}
          <div {...stylex.props(styles.rowActions)}>
            <ActionIcon
              active={isDefault}
              aria-label={defaultActionLabel}
              aria-pressed={isDefault}
              icon={StarIcon}
              size={{ blockSize: 20, size: 13 }}
              title={defaultActionLabel}
              onClick={(e) => void handleToggleDefault(e, entry, isDefault)}
            />
            {!isActive && (
              <ActionIcon
                aria-label={t('workingDirectory.removeRecent')}
                icon={XIcon}
                size={{ blockSize: 20, size: 12 }}
                title={t('workingDirectory.removeRecent')}
                onClick={(e) => handleRemoveRecent(e, entry)}
              />
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
        <div {...stylex.props(styles.searchBar)}>
          <Input
            autoFocus
            placeholder={t('workingDirectory.searchPlaceholder')}
            prefix={<Icon icon={SearchIcon} size={14} />}
            size="small"
            style={{ paddingInline: 0 }}
            value={search}
            variant="borderless"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <Flexbox horizontal align={'center'} distribution={'space-between'}>
        <div {...stylex.props(styles.sectionTitle)}>{t('workingDirectory.recent')}</div>
        {hasClearableSelection && (
          <div
            {...stylex.props(styles.clearText)}
            onClick={() => void clear().then(() => setOpen(false))}
          >
            {t('workingDirectory.clear')}
          </div>
        )}
      </Flexbox>
      <div {...stylex.props(styles.scrollContainer)}>
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
          // Start the browser at the directory this conversation actually runs in
          // (topic / agent override first), not the bare home folder.
          defaultCwd={selectedDir || deviceDefaultCwd}
          deviceId={targetDeviceId}
          onBeforeOpen={() => setOpen(false)}
          onPick={pick}
        />
      )}
    </Flexbox>
  );

  const displayName = selectedDir
    ? (getWorkingDirectoryName(selectedDir) ?? selectedDir)
    : t('workingDirectory.unselected');

  const trigger = (
    <div {...stylex.props(workingDirectoryChipStyles.chip)}>
      {selectedDir ? (
        <DirIcon repoType={recents.find((r) => r.path === selectedDir)?.repoType} />
      ) : (
        <DashedFolderIcon size={14} />
      )}
      <span {...stylex.props(workingDirectoryChipStyles.label)}>{displayName}</span>
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
          <Tooltip title={selectedDir || t('workingDirectory.title')}>{trigger}</Tooltip>
        )}
      </div>
    </Popover>
  );
});

WorkingDirectoryPicker.displayName = 'WorkingDirectoryPicker';

export default WorkingDirectoryPicker;
