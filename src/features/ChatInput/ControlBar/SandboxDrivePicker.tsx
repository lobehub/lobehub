'use client';

import { cx, Flexbox, Icon, Popover, Skeleton, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  FolderClockIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDriveIcon,
  InfoIcon,
  PackageIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { refreshProjectFiles } from '@/services/projectFile';
import { sandboxStorageService } from '@/services/sandboxStorage';

import OptionRow from './OptionRow';
import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

const styles = stylex.create({
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    justifyContent: 'space-between',
    paddingBlock: 4,
  },
  headerInfo: {
    color: cssVar.colorTextQuaternary,
    cursor: 'help',
  },
  headerTitle: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontWeight: 500,
  },
  notice: {
    backgroundColor: cssVar.colorWarningBg,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorWarningText,
    fontSize: 12,
    paddingBlock: 8,
    paddingInline: 8,
  },
  // StyleX longhands outrank the row's own emotion padding.
  option: {
    paddingInline: 0,
  },
  warning: {
    color: cssVar.colorWarning,
  },
});

const optionClassName = stylex.props(styles.option).className;

interface SandboxDrivePickerProps {
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
 * Nothing picked is the temporary sandbox; picking a folder on the drive is
 * the choice to keep files. A pick that can no longer be honoured — the
 * folder was deleted — is said on the chip itself, before the next message
 * runs somewhere the person did not choose. The environment the directory is
 * initialized from is a separate choice, beside this one, and every pick here
 * carries it along unchanged.
 *
 * A conversation from before environments became initializers may still be
 * bound to an environment directory; it is shown by name until another pick
 * replaces it.
 */
const SandboxDrivePicker = memo<SandboxDrivePickerProps>(
  ({ entitled, onChange, topicId, value }) => {
    const { t } = useTranslation(['chat', 'device']);
    const [open, setOpen] = useState(false);
    const workspaceId = useActiveWorkspaceId();
    const persistent = isPersistentSelection(value);

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
    const pick = async (placement: Omit<SandboxSelection, 'environmentId'>) => {
      // The environment is chosen beside the folder, not with it.
      const selection = { ...placement, environmentId: value.environmentId };
      await onChange(selection);
      void revalidatePlacement();
      if (topicId && !selection.instanceId && selection.workingDirectory !== undefined) {
        const folder = selection.workingDirectory === '.' ? '' : selection.workingDirectory;
        void refreshProjectFiles(`sandbox:${topicId}`, folder);
      }
    };

    const select = async (selection: Omit<SandboxSelection, 'environmentId'>) => {
      setOpen(false);
      try {
        await pick(selection);
      } catch {
        // The topic kept its old placement; said rather than left looking picked.
        toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
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
        onPick: pick,
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
        : currentLabel
      : t('sandboxStorage.ephemeral');

    const content = (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        <div {...stylex.props(styles.header)}>
          <Flexbox horizontal align={'center'} gap={4}>
            <span {...stylex.props(styles.headerTitle)}>{t('sandboxDrive.pickerTitle')}</span>
            <Tooltip title={t('sandboxDrive.pickerInfoTooltip')}>
              <span {...stylex.props(styles.headerInfo)}>
                <Icon icon={InfoIcon} size={12} />
              </span>
            </Tooltip>
          </Flexbox>
        </div>

        {fallbackMessage && (
          <Text className={stylex.props(styles.notice).className}>{fallbackMessage}</Text>
        )}

        <OptionRow
          active={!persistent}
          className={optionClassName}
          desc={t('sandboxStorage.ephemeralDesc')}
          icon={<Icon icon={TimerIcon} size={16} />}
          label={t('sandboxStorage.ephemeral')}
          onClick={() => void select({})}
        />

        {entitled && persistent && currentLabel && (
          <OptionRow
            active
            className={optionClassName}
            icon={<Icon icon={currentIcon} size={16} />}
            label={currentLabel}
            desc={
              value.instanceId
                ? t('sandboxDrive.environmentDesc')
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
            className={optionClassName}
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
            className={optionClassName}
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
              data-testid={'sandbox-drive-chip'}
              className={cx(
                workingDirectoryChipStyles.chip,
                fallback && stylex.props(styles.warning).className,
              )}
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
