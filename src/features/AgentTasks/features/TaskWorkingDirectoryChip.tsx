'use client';

import type { WorkingDirConfig, WorkingDirEntry } from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSourcePath } from '@lobechat/types';
import { Flexbox, Icon, Popover, Text, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronDownIcon, FolderPlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { formatLockedControlTooltip } from '@/features/ChatInput/utils/lockedControlTooltip';
import { openAddWorkingDirModal } from '@/features/WorkingDirectory';
import {
  getWorkingDirectoryName,
  getWorkingDirectoryPathString,
} from '@/helpers/workingDirectoryPath';
import { deviceService } from '@/services/device';
import { useDeviceList } from '@/store/device';
import { sx } from '@/styles/sx';

import { taskExecutionStyles as styles } from './taskExecutionStyles';
import TaskPickerOption from './TaskPickerOption';

interface TaskWorkingDirectoryChipProps {
  /** Row class for the trigger. Omitted → the composer's compact chip. */
  className?: string;
  /** The machine this task's runs land on — the picker offers ITS directories. */
  deviceId: string;
  disabled?: boolean;
  /**
   * Where the run starts while the task picks no directory: the device's default
   * chain for this machine. Shown and checked as the current value, so an unset
   * directory still reads as a concrete folder.
   */
  fallback?: WorkingDirConfig;
  /** Selected directory, or `undefined` to start in {@link fallback}. */
  onChange: (config?: WorkingDirConfig) => void;
  value?: WorkingDirConfig;
}

/**
 * The directory a task's runs start in, for a run pinned to a machine.
 *
 * Shown only once the task stops following the agent — following covers the
 * directory as well, so there is no "follow" row here: every row is a folder on
 * this machine, and the one the run uses is checked.
 *
 * This is the device-side counterpart of {@link TaskRepoChip}, and which of the
 * two a task gets is decided by its TARGET, never by taste: a run on a machine
 * starts in an absolute path on that machine, so offering a cloud repo
 * identifier here would store a value the run cannot use.
 *
 * Recents are the device's own (`device.workingDirs`) — the same list the chat
 * composer's picker reads — and a new one is added through the shared modal,
 * which validates the path against that device when it can reach it.
 */
const TaskWorkingDirectoryChip = memo<TaskWorkingDirectoryChipProps>(
  ({ className, deviceId, disabled, fallback, onChange, value }) => {
    const { t } = useTranslation('chat');
    const { t: tDevice } = useTranslation('device');
    const [open, setOpen] = useState(false);

    // `useDeviceList` mounts the device replica's sync itself: a task page may
    // render nothing else that fetches the list, which left the recents empty
    // on a cold load.
    const { data: devices } = useDeviceList();
    const device = devices?.find((item) => item.deviceId === deviceId);
    const deviceDefaultCwd = getWorkingDirectoryPathString(device?.defaultCwd ?? undefined);
    const rawRecents = device?.workingDirs;

    const selectedPath = getWorkingDirEffectivePath(value);
    // The folder the run starts in: the task's own pick, else the machine's default.
    const current = selectedPath ? value : fallback;
    const currentPath = getWorkingDirEffectivePath(current);

    // The folder in use leads the list when it is not a recent (a device default
    // nobody has opened yet), so the checked state always has a row to land on.
    const recents = useMemo<WorkingDirEntry[]>(() => {
      const entries = (rawRecents ?? []).filter(
        (entry) => !!getWorkingDirectoryPathString(entry.path),
      );
      if (
        !currentPath ||
        entries.some((entry) => getWorkingDirectoryPathString(entry.path) === currentPath)
      )
        return entries;
      return [{ path: currentPath, repoType: current?.repoType }, ...entries];
    }, [current?.repoType, currentPath, rawRecents]);

    const apply = useCallback(
      (config?: WorkingDirConfig) => {
        onChange(config);
        setOpen(false);
      },
      [onChange],
    );

    const handlePick = useCallback(
      (entry: WorkingDirEntry) => {
        const path = getWorkingDirectoryPathString(entry.path);
        if (!path) return;
        apply({ path, ...(entry.repoType && { repoType: entry.repoType }) });
      },
      [apply],
    );

    const handleAdd = useCallback(() => {
      setOpen(false);
      openAddWorkingDirModal({
        defaultPath: currentPath ?? deviceDefaultCwd,
        deviceId,
        onSubmit: async (path) => {
          // An unreachable device returns null; that is "can't verify", not
          // "wrong", so the path is accepted without a repoType rather than
          // blocked — the same rule the chat picker follows.
          const result = await deviceService.statPath(deviceId, path).catch(() => undefined);
          if (result) {
            if (!result.exists) return tDevice('workingDirectory.pathNotExist');
            if (!result.isDirectory) return tDevice('workingDirectory.pathNotDirectory');
          }
          onChange({ path, ...(result?.repoType && { repoType: result.repoType }) });
          return undefined;
        },
      });
    }, [currentPath, deviceDefaultCwd, deviceId, onChange, tDevice]);

    const chipLabel = currentPath
      ? (getWorkingDirectoryName(currentPath) ?? currentPath)
      : t('taskExecution.selectDirectory');

    const content = (
      <Flexbox
        aria-label={t('taskExecution.workingDirectory')}
        gap={4}
        role={'group'}
        style={{ maxWidth: 'calc(100vw - 48px)', width: 320 }}
      >
        <div className={stylex.props(styles.sectionTitle).className}>
          {t('taskExecution.workingDirectory')}
        </div>
        <div className={stylex.props(styles.scroll).className}>
          {recents.length === 0 ? (
            <div className={stylex.props(styles.emptyHint).className}>
              {t('workingDirectory.noRecent', { ns: 'device' })}
            </div>
          ) : (
            recents.map((entry) => {
              const path = getWorkingDirectoryPathString(entry.path)!;
              const isActive = path === currentPath;
              const isDefault =
                !!deviceDefaultCwd && getWorkingDirSourcePath(entry) === deviceDefaultCwd;
              return (
                <TaskPickerOption
                  checked={isActive}
                  disabled={disabled}
                  key={entry.path}
                  onSelect={() => handlePick(entry)}
                >
                  <DirIcon repoType={entry.repoType} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align={'center'} gap={6}>
                      <div className={stylex.props(styles.rowTitle).className}>
                        {getWorkingDirectoryName(path) ?? path}
                      </div>
                      {isDefault && (
                        <span className={stylex.props(styles.badge).className}>
                          {t('workingDirectory.defaultBadge', { ns: 'device' })}
                        </span>
                      )}
                    </Flexbox>
                    <div className={stylex.props(styles.rowDesc).className}>{path}</div>
                  </Flexbox>
                  {isActive && (
                    <Icon
                      className={stylex.props(styles.check).className}
                      icon={CheckIcon}
                      size={14}
                    />
                  )}
                </TaskPickerOption>
              );
            })
          )}
        </div>
        <TaskPickerOption disabled={disabled} onSelect={() => handleAdd()}>
          <Icon className={stylex.props(styles.icon).className} icon={FolderPlusIcon} size={16} />
          <div className={stylex.props(styles.rowTitle).className}>
            {t('workingDirectory.addFolder', { ns: 'device' })}
          </div>
        </TaskPickerOption>
      </Flexbox>
    );

    // The muted directory trigger, not a chip — see `directoryTrigger`.
    const trigger = (
      <div
        {...sx(
          [className ? null : styles.directoryTrigger, disabled && styles.triggerDisabled],
          className,
        )}
      >
        <DirIcon repoType={current?.repoType} size={14} />
        <Text ellipsis className={stylex.props(styles.chipLabel).className} fontSize={12}>
          {chipLabel}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    );

    if (disabled) {
      return (
        <Tooltip
          title={formatLockedControlTooltip(
            t('taskExecution.workingDirectory'),
            t('taskExecution.fixedTip'),
          )}
        >
          {trigger}
        </Tooltip>
      );
    }

    return (
      <Popover
        content={content}
        open={open}
        placement="bottomLeft"
        styles={{ content: { padding: 4 } }}
        trigger="click"
        onOpenChange={setOpen}
      >
        {trigger}
      </Popover>
    );
  },
);

TaskWorkingDirectoryChip.displayName = 'TaskWorkingDirectoryChip';

export default TaskWorkingDirectoryChip;
