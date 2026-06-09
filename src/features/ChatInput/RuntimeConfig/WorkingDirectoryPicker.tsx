'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  XIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

import { openAddWorkingDirModal } from './AddWorkingDirModal';
import { renderDirIcon } from './dirIcon';
import { useCommitWorkingDirectory } from './useCommitWorkingDirectory';
import { useMigrateDeviceRecents } from './useMigrateDeviceRecents';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
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
  `,
  dirItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  dirName: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  dirPath: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  removeBtn: css`
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
  scrollContainer: css`
    overflow-y: auto;
    max-height: 360px;
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
 */
const WorkingDirectoryPicker = memo<WorkingDirectoryPickerProps>(({ agentId }) => {
  const { t } = useTranslation('device');
  const [open, setOpen] = useState(false);

  // Populate the device store (SWR dedupes across callers).
  useDeviceStore((s) => s.useFetchDevices)();
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
  const legacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );

  // The explicitly-selected cwd (no home fallback) — drives the active check and
  // the Clear affordance.
  const selectedDir = resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
  });

  // Clear only makes sense when an agent-level override exists. The device-wide
  // `deviceDefaultCwd` isn't clearable from here (it's a device setting), so
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

  const pick = async (entry: { path: string; repoType?: 'git' | 'github' }) => {
    await commit(entry);
    setOpen(false);
  };

  const handleRemoveRecent = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (targetDeviceId) void removeDeviceWorkingDir(targetDeviceId, path);
  };

  const content = (
    <Flexbox gap={4} style={{ minWidth: 280 }}>
      <Flexbox horizontal align={'center'} distribution={'space-between'}>
        <div className={styles.sectionTitle}>{t('workingDirectory.recent')}</div>
        {hasClearableSelection && (
          <div className={styles.clearText} onClick={() => void clear().then(() => setOpen(false))}>
            {t('workingDirectory.clear')}
          </div>
        )}
      </Flexbox>
      <div className={styles.scrollContainer}>
        {recents.length === 0 ? (
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{ color: cssVar.colorTextQuaternary, fontSize: 12, padding: '12px 8px' }}
          >
            {t('workingDirectory.noRecent')}
          </Flexbox>
        ) : (
          recents.map((entry) => {
            const isActive = entry.path === selectedDir;
            return (
              <Flexbox
                horizontal
                align={'center'}
                className={cx(styles.dirItem, isActive && styles.dirItemActive)}
                gap={8}
                key={entry.path}
                onClick={() => void pick(entry)}
              >
                {renderDirIcon(entry.repoType)}
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <div className={styles.dirName}>{getDirName(entry.path)}</div>
                  <div className={styles.dirPath}>{entry.path}</div>
                </Flexbox>
                {isActive ? (
                  <Icon
                    icon={CheckIcon}
                    size={16}
                    style={{ color: cssVar.colorSuccess, flex: 'none' }}
                  />
                ) : (
                  <div
                    className={styles.removeBtn}
                    title={t('workingDirectory.removeRecent')}
                    onClick={(e) => handleRemoveRecent(e, entry.path)}
                  >
                    <Icon icon={XIcon} size={12} />
                  </div>
                )}
              </Flexbox>
            );
          })
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
        renderDirIcon(recents.find((r) => r.path === selectedDir)?.repoType)
      ) : (
        <Icon icon={FolderIcon} size={14} />
      )}
      <span>{displayName}</span>
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
