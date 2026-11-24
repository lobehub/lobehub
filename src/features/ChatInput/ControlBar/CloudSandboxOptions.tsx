'use client';

import { Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { refreshProjectFiles } from '@/services/projectFile';
import { sandboxStorageService } from '@/services/sandboxStorage';

import SandboxDriveMenu, { type SandboxDriveFolderPick } from './SandboxDriveMenu';
import { useSandboxFolder } from './useSandboxFolder';
import type { useSandboxOptions } from './useSandboxOptions';
import type { SandboxSelection } from './useSandboxPlacement';

const styles = stylex.create({
  notice: {
    backgroundColor: cssVar.colorWarningBg,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorWarningText,
    fontSize: 12,
    paddingBlock: 8,
    paddingInline: 8,
  },
});

interface CloudSandboxOptionsProps {
  /** Closes the whole execution-environment menu. */
  onClose: () => void;
  /** Moves the conversation to the cloud sandbox before an option is applied, when it is elsewhere. */
  onEnsureSandbox: () => Promise<void>;
  options: ReturnType<typeof useSandboxOptions>;
}

/**
 * Where the cloud sandbox keeps its files, listed directly under its row in
 * the execution-environment menu: a temporary sandbox (cleaned up with the
 * session), or a folder of the drive. The cloud sandbox is not set up from an
 * environment — coding runs on a device — so storage is its only option.
 *
 * Picking any option also moves the conversation to the cloud sandbox. A pick
 * that can no longer be honoured — the folder was deleted — is said at the
 * top, before the next message runs somewhere the person did not choose.
 */
const CloudSandboxOptions = memo<CloudSandboxOptionsProps>(
  ({ onClose, onEnsureSandbox, options }) => {
    const { t } = useTranslation(['chat', 'device']);
    const {
      driveStatus,
      entitled,
      onDrive,
      pickFolder: saveFolder,
      selection,
      toTemporary,
      topicId,
      workspaceId,
    } = options;
    const current = useSandboxFolder(selection, entitled);

    // Whether the pick still holds, asked of the same resolver the run uses:
    // a folder deleted on a shared drive sends the next run to a temporary
    // sandbox — and the menu says so first.
    const { data: placement, mutate: revalidatePlacement } = useSWR(
      entitled && topicId && onDrive
        ? [
            'sandbox-drive-placement',
            topicId,
            selection.drive ?? '',
            selection.instanceId ?? '',
            selection.workingDirectory ?? '',
          ]
        : null,
      () => sandboxStorageService.resolveSessionPlacement({ topicId }),
      { revalidateOnFocus: true },
    );
    const fallback = placement?.fallback;

    const pickTemporary = async () => {
      onClose();
      try {
        await onEnsureSandbox();
        await toTemporary();
        void revalidatePlacement();
      } catch {
        toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
      }
    };

    const pickFolder = async (folder: SandboxDriveFolderPick) => {
      onClose();
      let next: SandboxSelection;
      try {
        await onEnsureSandbox();
        next = await saveFolder(folder);
      } catch {
        toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
        return;
      }
      void revalidatePlacement();
      if (topicId) {
        const path = next.workingDirectory === '.' ? '' : (next.workingDirectory ?? '');
        void refreshProjectFiles(`sandbox:${topicId}`, path);
      }
    };

    const openBrowser = () => {
      onClose();
      openSandboxDirectoryModal({
        // A folder that is gone cannot be listed; start from the top instead.
        defaultPath:
          selection.workingDirectory &&
          selection.workingDirectory !== '.' &&
          fallback !== 'directoryMissing'
            ? selection.workingDirectory
            : undefined,
        drive: selection.drive,
        isWorkspace: !!workspaceId,
        onPick: pickFolder,
      });
    };

    return (
      <Flexbox gap={2}>
        {fallback && (
          <Text className={stylex.props(styles.notice).className}>
            {t(`sandboxDrive.fallback.${fallback}`)}
          </Text>
        )}

        <SandboxDriveMenu
          entitled={driveStatus === 'hidden' ? undefined : driveStatus !== 'upgrade'}
          selectedLabel={onDrive ? current.label : undefined}
          // A legacy environment directory can sit on a drive this list does
          // not show, so its row names it and picks nothing.
          selectedPath={onDrive && !selection.instanceId ? current.path : undefined}
          temporary={!onDrive}
          onBrowse={openBrowser}
          onPick={(folder) => void pickFolder(folder)}
          onPickTemporary={() => void pickTemporary()}
          onUpgrade={() => {
            onClose();
            openSandboxStorageUpsell();
          }}
        />
      </Flexbox>
    );
  },
);

CloudSandboxOptions.displayName = 'CloudSandboxOptions';

export default CloudSandboxOptions;
