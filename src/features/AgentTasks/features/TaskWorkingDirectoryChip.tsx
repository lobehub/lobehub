'use client';

import type { WorkingDirConfig, WorkingDirEntry } from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSourcePath } from '@lobechat/types';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckIcon, ChevronDownIcon, FolderPlusIcon, SquircleDashed } from 'lucide-react';
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
import { deviceSelectors, useDeviceStore } from '@/store/device';

import { taskExecutionStyles as styles } from './taskExecutionStyles';

interface TaskWorkingDirectoryChipProps {
  /** Row class for the trigger. Omitted → the composer's compact chip. */
  className?: string;
  /** The machine this task's runs land on — the picker offers ITS directories. */
  deviceId: string;
  disabled?: boolean;
  /** Selected directory, or `undefined` to inherit the agent's own. */
  onChange: (config?: WorkingDirConfig) => void;
  value?: WorkingDirConfig;
}

/**
 * The directory a task's runs start in, for a run pinned to a machine.
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
  ({ className, deviceId, disabled, onChange, value }) => {
    const { t } = useTranslation('chat');
    const { t: tDevice } = useTranslation('device');
    const [open, setOpen] = useState(false);

    const rawRecents = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(deviceId));
    const rawDeviceDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(deviceId));
    const deviceDefaultCwd = getWorkingDirectoryPathString(rawDeviceDefaultCwd);

    const recents = useMemo(
      () => rawRecents.filter((entry) => !!getWorkingDirectoryPathString(entry.path)),
      [rawRecents],
    );

    const selectedPath = getWorkingDirEffectivePath(value);

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
        defaultPath: selectedPath ?? deviceDefaultCwd,
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
    }, [deviceDefaultCwd, deviceId, onChange, selectedPath, tDevice]);

    const chipLabel = selectedPath
      ? (getWorkingDirectoryName(selectedPath) ?? selectedPath)
      : t('taskExecution.followAgent');

    const content = (
      <Flexbox gap={4} style={{ maxWidth: 'calc(100vw - 48px)', width: 320 }}>
        <div className={styles.sectionTitle}>{t('taskExecution.workingDirectory')}</div>
        <Flexbox
          horizontal
          align={'center'}
          className={`${styles.row} ${selectedPath ? '' : styles.rowActive}`}
          gap={8}
          onClick={() => {
            if (disabled) return;
            apply(undefined);
          }}
        >
          <Icon className={styles.icon} icon={SquircleDashed} size={16} />
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <div className={styles.rowTitle}>{t('taskExecution.followAgent')}</div>
            <div className={styles.rowDesc}>{t('taskExecution.followAgentDesc')}</div>
          </Flexbox>
          {!selectedPath && <Icon className={styles.check} icon={CheckIcon} size={14} />}
        </Flexbox>
        <div className={styles.scroll}>
          {recents.length === 0 ? (
            <div className={styles.emptyHint}>
              {t('workingDirectory.noRecent', { ns: 'device' })}
            </div>
          ) : (
            recents.map((entry) => {
              const path = getWorkingDirectoryPathString(entry.path)!;
              const isActive = path === selectedPath;
              const isDefault =
                !!deviceDefaultCwd && getWorkingDirSourcePath(entry) === deviceDefaultCwd;
              return (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  gap={8}
                  key={entry.path}
                  onClick={() => {
                    if (disabled) return;
                    handlePick(entry);
                  }}
                >
                  <DirIcon repoType={entry.repoType} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align={'center'} gap={6}>
                      <div className={styles.rowTitle}>{getWorkingDirectoryName(path) ?? path}</div>
                      {isDefault && (
                        <span className={styles.badge}>
                          {t('workingDirectory.defaultBadge', { ns: 'device' })}
                        </span>
                      )}
                    </Flexbox>
                    <div className={styles.rowDesc}>{path}</div>
                  </Flexbox>
                  {isActive && <Icon className={styles.check} icon={CheckIcon} size={14} />}
                </Flexbox>
              );
            })
          )}
        </div>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.row}
          gap={8}
          onClick={() => {
            if (disabled) return;
            handleAdd();
          }}
        >
          <Icon className={styles.icon} icon={FolderPlusIcon} size={16} />
          <div className={styles.rowTitle}>{t('workingDirectory.addFolder', { ns: 'device' })}</div>
        </Flexbox>
      </Flexbox>
    );

    // The muted directory trigger, not a chip — see `directoryTrigger`.
    const trigger = (
      <div className={cx(className ?? styles.directoryTrigger, disabled && styles.triggerDisabled)}>
        {selectedPath ? (
          <DirIcon repoType={value?.repoType} size={14} />
        ) : (
          <Icon icon={SquircleDashed} size={14} />
        )}
        <Text ellipsis className={styles.chipLabel} fontSize={12}>
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
