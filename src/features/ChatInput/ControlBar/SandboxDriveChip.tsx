'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Flexbox, Icon, Popover, Skeleton, Switch, Tag, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  FolderIcon,
  HardDriveIcon,
  PackageIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { SANDBOX_STORAGE_PATH } from '@/features/ResourceHome/paths';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { refreshProjectFiles } from '@/services/projectFile';
import { sandboxStorageService } from '@/services/sandboxStorage';

import OptionRow from './OptionRow';
import SandboxDriveMenu, { type SandboxDriveFolderPick } from './SandboxDriveMenu';
import { selectionWithFolder } from './sandboxEnvironmentOptions';
import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

const styles = stylex.create({
  notice: {
    backgroundColor: cssVar.colorWarningBg,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorWarningText,
    fontSize: 12,
    paddingBlock: 8,
    paddingInline: 8,
  },
  warning: {
    color: cssVar.colorWarning,
  },
});

interface SandboxDriveChipProps {
  /** Whether this plan includes a drive. Without one the switch leads to a plan. */
  entitled: boolean;
  onChange: (selection: SandboxSelection) => Promise<void>;
  /** Switches the drive on or off; the section decides the folder it starts on. */
  onToggle: (enabled: boolean) => Promise<void>;
  topicId?: string;
  /** Where this conversation works today. */
  value: SandboxSelection;
}

const folderName = (path: string) => path.split('/').pop() || path;

/**
 * Whether the cloud sandbox keeps its files on the drive, and in which folder.
 * Off is the temporary sandbox, cleaned up with the session. The environment
 * the run is set up from is a separate chip beside this one: the two are
 * independent, and either can be set without the other.
 *
 * A pick that can no longer be honoured — the folder was deleted — is said on
 * the chip itself, before the next message runs somewhere the person did not
 * choose. A conversation from before environments became initializers may
 * still be bound to an environment directory; it is shown by name until
 * another pick replaces it.
 */
const SandboxDriveChip = memo<SandboxDriveChipProps>(
  ({ entitled, onChange, onToggle, topicId, value }) => {
    const { t } = useTranslation(['chat', 'device']);
    const [open, setOpen] = useState(false);
    const [toggling, setToggling] = useState(false);
    const workspaceId = useActiveWorkspaceId();
    const navigate = useWorkspaceAwareNavigate();
    const persistent = isPersistentSelection(value);
    const onDrive = entitled && persistent;

    // A legacy environment directory's own row, for its name — from the
    // database, so the chip never waits on a sandbox.
    const { data: instance, isLoading: instanceLoading } = useSWR(
      entitled && value.instanceId ? ['sandbox-drive-chip-instance', value.instanceId] : null,
      () => sandboxStorageService.getInstance({ id: value.instanceId! }),
    );

    // Whether the pick still holds, asked of the same resolver the run uses:
    // a folder deleted on a shared drive, or an environment directory gone,
    // sends the next run to a temporary sandbox — and the chip says so first.
    const { data: placement, mutate: revalidatePlacement } = useSWR(
      entitled && topicId && persistent
        ? [
            'sandbox-drive-placement',
            topicId,
            value.drive ?? '',
            value.instanceId ?? '',
            value.workingDirectory ?? '',
            value.environmentId ?? '',
          ]
        : null,
      () => sandboxStorageService.resolveSessionPlacement({ topicId }),
      { revalidateOnFocus: true },
    );
    const fallback = placement?.fallback;

    // An environment is only set up in an empty folder. Picking one that
    // already holds files keeps the files and skips the setup — said once, at
    // the pick, rather than left to look applied.
    const warnIfSetupSkipped = async (pick: SandboxSelection) => {
      if (!pick.environmentId || pick.workingDirectory === undefined) return;
      try {
        const { entries } = await sandboxStorageService.listFiles({
          drive: pick.drive,
          path: pick.workingDirectory === '.' ? undefined : pick.workingDirectory,
        });
        if (entries.length > 0) toast.info(t('sandboxDrive.setupSkipped'));
      } catch {
        // A folder that cannot be listed yet is created empty on the first run.
      }
    };

    const pickFolder = async (folder: SandboxDriveFolderPick) => {
      setOpen(false);
      const next = selectionWithFolder(value, folder);
      try {
        await onChange(next);
      } catch {
        // The topic kept its old placement; said rather than left looking picked.
        toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
        return;
      }
      // Picking the folder already held keeps the keys unchanged, so SWR would
      // go on showing the old answers. Ask once more after every pick.
      void revalidatePlacement();
      if (topicId) {
        const path = next.workingDirectory === '.' ? '' : (next.workingDirectory ?? '');
        void refreshProjectFiles(`sandbox:${topicId}`, path);
      }
      void warnIfSetupSkipped(next);
    };

    const toggle = async (enabled: boolean) => {
      setToggling(true);
      try {
        await onToggle(enabled);
        void revalidatePlacement();
      } catch {
        toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
      } finally {
        setToggling(false);
      }
    };

    const openBrowser = () => {
      setOpen(false);
      openSandboxDirectoryModal({
        // A folder that is gone cannot be listed; start from the top instead.
        defaultPath:
          value.workingDirectory &&
          value.workingDirectory !== '.' &&
          fallback !== 'directoryMissing'
            ? value.workingDirectory
            : undefined,
        drive: value.drive,
        isWorkspace: !!workspaceId,
        onPick: pickFolder,
      });
    };

    const currentLabel = value.instanceId
      ? (instance?.name ?? instance?.workingDirectory)
      : value.workingDirectory === '.'
        ? t('sandboxDrive.root')
        : value.workingDirectory
          ? folderName(value.workingDirectory)
          : undefined;

    const fallbackMessage = fallback ? t(`sandboxDrive.fallback.${fallback}`) : undefined;
    const chipIcon = fallback ? (
      <Icon icon={TriangleAlertIcon} size={14} />
    ) : onDrive ? (
      <Icon icon={value.instanceId ? PackageIcon : FolderIcon} size={14} />
    ) : (
      <Icon icon={TimerIcon} size={14} />
    );
    const chipLabel = fallback
      ? t(`sandboxDrive.fallbackChip.${fallback}`)
      : onDrive
        ? currentLabel
        : t('sandboxDrive.off');

    const toggleRow = entitled ? (
      <OptionRow
        compact
        desc={t(onDrive ? 'sandboxDrive.onDesc' : 'sandboxDrive.offDesc')}
        disabled={toggling}
        icon={<Icon icon={HardDriveIcon} size={16} />}
        label={t('sandboxDrive.toggle')}
        extra={
          <Switch
            loading={toggling}
            size={'small'}
            value={onDrive}
            onChange={(enabled) => void toggle(enabled)}
          />
        }
        onClick={() => void toggle(!onDrive)}
      />
    ) : (
      <OptionRow
        compact
        desc={t('sandboxDrive.offDesc')}
        icon={<Icon icon={HardDriveIcon} size={16} />}
        label={t('sandboxDrive.toggle')}
        badge={
          <Tag color={'gold'} size={'small'} style={{ borderRadius: 999, paddingInline: 8 }}>
            {t('pro', { ns: 'common' })}
          </Tag>
        }
        onClick={() => {
          setOpen(false);
          openSandboxStorageUpsell();
        }}
      />
    );

    const content = (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        {fallbackMessage && (
          <Text className={stylex.props(styles.notice).className}>{fallbackMessage}</Text>
        )}
        <SandboxDriveMenu
          selectedLabel={onDrive ? currentLabel : undefined}
          // A legacy environment directory is not a folder of this list.
          selectedPath={onDrive && !value.instanceId ? value.workingDirectory : undefined}
          showFolders={onDrive}
          toggle={toggleRow}
          onBrowse={openBrowser}
          onPick={(folder) => void pickFolder(folder)}
          onOpenStorage={() => {
            setOpen(false);
            navigate(SANDBOX_STORAGE_PATH);
          }}
        />
      </Flexbox>
    );

    if (!ENABLE_BUSINESS_FEATURES) return null;

    const resolving = !!value.instanceId && !instance && instanceLoading;

    // A plain div between the popover and the chip, as the device picker has:
    // the popover merges trigger props into its direct child.
    return (
      <Popover
        arrow={false}
        content={content}
        open={open}
        placement={'topLeft'}
        styles={{ content: { padding: 4 } }}
        trigger={'click'}
        onOpenChange={setOpen}
      >
        <div>
          <Tooltip title={fallbackMessage}>
            <div
              data-testid={'sandbox-drive-chip'}
              {...stylex.props(workingDirectoryChipStyles.chip, fallback && styles.warning)}
            >
              {chipIcon}
              {resolving ? (
                <Skeleton.Text rows={1} style={{ height: 12, width: 56 }} />
              ) : (
                <span {...stylex.props(workingDirectoryChipStyles.label)}>{chipLabel}</span>
              )}
              <Icon icon={ChevronDownIcon} size={12} />
            </div>
          </Tooltip>
        </div>
      </Popover>
    );
  },
);

SandboxDriveChip.displayName = 'SandboxDriveChip';

export default SandboxDriveChip;
