'use client';

import { createStaticStyles, cssVar, cx, Flexbox, Icon, Popover, Skeleton, Text, Tooltip } from '@lobehub/ui';
import {
  ChevronDownIcon,
  FolderClockIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDriveIcon,
  InfoIcon,
  PackageIcon,
  SettingsIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { refreshProjectFiles } from '@/services/projectFile';
import { sandboxStorageService } from '@/services/sandboxStorage';

import OptionRow from './OptionRow';
import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px;
  `,
  headerInfo: css`
    cursor: help;
    color: ${cssVar.colorTextQuaternary};
  `,
  headerTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  manageButton: css`
    cursor: pointer;

    display: flex;
    gap: 3px;
    align-items: center;

    padding: 0;
    border: none;

    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};

    background: none;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  notice: css`
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
  option: css`
    && {
      padding-inline: 0;
    }
  `,
  warning: css`
    color: ${cssVar.colorWarning};
  `,
}));

/** How often a building environment directory is re-read while the chip names it. */
const BUILD_REFRESH_MS = 4000;

interface SandboxDrivePickerProps {
  /** The conversation's agent is shared with the workspace; see `useSandboxDirectorySource`. */
  agentIsPublic?: boolean;
  /** Whether this plan includes a drive. Without one the menu offers the way to a plan. */
  entitled: boolean;
  onChange: (selection: SandboxSelection) => Promise<void>;
  topicId?: string;
  /** Where this conversation works today. */
  value: SandboxSelection;
}

const folderName = (path: string) => path.split('/').pop() || path;

/**
 * Where a cloud-sandbox run works, offered the way the device picker offers
 * folders: the chip names the place, the menu holds the temporary sandbox and
 * the way into the drive's directory browser.
 *
 * Nothing picked is the temporary sandbox. Picking a folder on the drive is
 * the choice to keep files; picking an environment directory also keeps what
 * its setup installed. A pick that can no longer be honoured — the folder was
 * deleted, the environment directory is gone — is said on the chip itself,
 * before the next message runs somewhere the person did not choose.
 */
const SandboxDrivePicker = memo<SandboxDrivePickerProps>(
  ({ agentIsPublic, entitled, onChange, topicId, value }) => {
    const { t } = useTranslation(['chat', 'device']);
    const [open, setOpen] = useState(false);
    const navigate = useWorkspaceAwareNavigate();
    const workspaceId = useActiveWorkspaceId();
    const persistent = isPersistentSelection(value);

    // The environment directory's own row, for its name and build state —
    // from the database, so the chip never waits on a sandbox. While a build
    // is running the poll also asks for its status: nothing calls back when a
    // build ends, and that call is what settles the row, so a chip left to
    // re-read the row alone would say "building" for good.
    const { data: instance, isLoading: instanceLoading } = useSWR(
      entitled && value.instanceId ? ['sandbox-drive-chip-instance', value.instanceId] : null,
      async () => {
        const id = value.instanceId!;
        const row = await sandboxStorageService.getInstance({ id });
        if (row?.status !== 'pending' || !row.buildId) return row;

        await sandboxStorageService.instanceBuildStatus({ id, topicId }).catch(() => undefined);
        return sandboxStorageService.getInstance({ id });
      },
      {
        refreshInterval: (latest) => (latest?.status === 'pending' ? BUILD_REFRESH_MS : 0),
      },
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
          ]
        : null,
      () => sandboxStorageService.resolveSessionPlacement({ topicId }),
      { revalidateOnFocus: true },
    );
    const fallback = placement?.fallback;

    // Picking the folder already held keeps the keys unchanged, so SWR would
    // go on showing the old answers — "no longer exists" on the chip and an
    // unreadable tree in the working panel, for a folder just re-created and
    // picked again. Ask once more after every pick.
    const pick = async (selection: SandboxSelection) => {
      await onChange(selection);
      void revalidatePlacement();
      if (topicId && !selection.instanceId && selection.workingDirectory !== undefined) {
        const folder = selection.workingDirectory === '.' ? '' : selection.workingDirectory;
        void refreshProjectFiles(`sandbox:${topicId}`, folder);
      }
    };

    const select = async (selection: SandboxSelection) => {
      setOpen(false);
      await pick(selection);
    };

    const openBrowser = () => {
      setOpen(false);
      openSandboxDirectoryModal({
        agentIsPublic,
        // A folder that is gone cannot be listed; start from the top instead.
        defaultPath:
          value.workingDirectory &&
          value.workingDirectory !== '.' &&
          fallback !== 'directoryMissing'
            ? value.workingDirectory
            : undefined,
        drive: value.drive,
        isWorkspace: !!workspaceId,
        onPick: pick,
        topicId,
      });
    };

    const currentLabel = value.instanceId
      ? (instance?.name ?? instance?.workingDirectory)
      : value.workingDirectory === '.'
        ? t('sandboxDrive.root')
        : value.workingDirectory
          ? folderName(value.workingDirectory)
          : undefined;
    const currentIcon = value.instanceId ? PackageIcon : FolderIcon;
    const building = instance?.status === 'pending';

    const fallbackMessage = fallback ? t(`sandboxDrive.fallback.${fallback}`) : undefined;
    // In a workspace a folder path means nothing without its drive.
    const driveName = workspaceId
      ? t(`workingDirectory.drive.drives.${value.drive ?? 'public'}`, { ns: 'device' })
      : undefined;

    const chipIcon = fallback ? (
      <Icon icon={TriangleAlertIcon} size={14} />
    ) : persistent ? (
      <Icon icon={currentIcon} size={14} />
    ) : (
      <Icon icon={TimerIcon} size={14} />
    );
    const chipLabel = persistent
      ? fallback
        ? t(`sandboxDrive.fallbackChip.${fallback}`)
        : building
          ? t('sandboxDrive.building', { name: currentLabel })
          : currentLabel
      : t('sandboxStorage.ephemeral');

    const content = (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        <div className={styles.header}>
          <Flexbox horizontal align={'center'} gap={4}>
            <span className={styles.headerTitle}>{t('sandboxDrive.pickerTitle')}</span>
            <Tooltip title={t('sandboxDrive.pickerInfoTooltip')}>
              <span className={styles.headerInfo}>
                <Icon icon={InfoIcon} size={12} />
              </span>
            </Tooltip>
          </Flexbox>
          <button
            className={styles.manageButton}
            type={'button'}
            onClick={() => {
              setOpen(false);
              navigate('/settings/environments');
            }}
          >
            <Icon icon={SettingsIcon} size={11} />
            <span>{t('sandboxDrive.manageEnvironments')}</span>
          </button>
        </div>

        {fallbackMessage && <Text className={styles.notice}>{fallbackMessage}</Text>}

        <OptionRow
          active={!persistent}
          className={styles.option}
          desc={t('sandboxStorage.ephemeralDesc')}
          icon={<Icon icon={TimerIcon} size={16} />}
          label={t('sandboxStorage.ephemeral')}
          onClick={() => void select({})}
        />

        {entitled && persistent && currentLabel && (
          <OptionRow
            active
            className={styles.option}
            icon={<Icon icon={currentIcon} size={16} />}
            label={currentLabel}
            desc={
              value.instanceId
                ? t(
                    building
                      ? 'sandboxDrive.environmentBuildingDesc'
                      : 'sandboxDrive.environmentDesc',
                  )
                : driveName
                  ? t('sandboxDrive.folderOnDriveDesc', {
                      drive: driveName,
                      path: value.workingDirectory === '.' ? '/' : `/${value.workingDirectory}`,
                    })
                  : t('sandboxDrive.folderDesc', {
                      path: value.workingDirectory === '.' ? '/' : `/${value.workingDirectory}`,
                    })
            }
            onClick={() => setOpen(false)}
          />
        )}

        {entitled && (
          <OptionRow
            className={styles.option}
            desc={t('sandboxDrive.browseDesc')}
            icon={<Icon icon={persistent ? FolderOpenIcon : HardDriveIcon} size={16} />}
            label={t(persistent ? 'sandboxDrive.browseOther' : 'sandboxDrive.browse')}
            onClick={openBrowser}
          />
        )}

        {!entitled && (
          // The drive is part of a plan this account is not on. Offered in the
          // same list, in the same shape, so the row reads as one more place
          // files could go — and the tag says why it is not simply selectable.
          <OptionRow
            className={styles.option}
            desc={t('sandboxStorage.persistentUpsellDesc')}
            icon={<Icon icon={FolderClockIcon} size={16} />}
            label={t('sandboxDrive.upsell')}
            tag={t('pro', { ns: 'common' })}
            onClick={() => {
              setOpen(false);
              openSandboxStorageUpsell();
            }}
          />
        )}
      </Flexbox>
    );

    const resolving = !!value.instanceId && !instance && instanceLoading;

    // A plain div between the popover and the chip, as the device picker has:
    // the popover merges trigger props into its direct child.
    return (
      <Popover
        arrow={false}
        content={content}
        open={open}
        placement={'topLeft'}
        trigger={'click'}
        onOpenChange={setOpen}
      >
        <div>
          <Tooltip title={fallbackMessage}>
            <div
              className={cx(workingDirectoryChipStyles.chip, fallback && styles.warning)}
              data-testid={'sandbox-drive-chip'}
            >
              {chipIcon}
              {resolving ? (
                <Skeleton.Text rows={1} style={{ height: 12, width: 56 }} />
              ) : (
                <span className={workingDirectoryChipStyles.label}>{chipLabel}</span>
              )}
              <Icon icon={ChevronDownIcon} size={12} />
            </div>
          </Tooltip>
        </div>
      </Popover>
    );
  },
);

SandboxDrivePicker.displayName = 'SandboxDrivePicker';

export default SandboxDrivePicker;
