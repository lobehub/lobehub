'use client';

import { Flexbox, Icon, Popover, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleOffIcon, ContainerIcon, FolderIcon, PackageIcon, TimerIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import RepositoryAvatar from '@/components/RepositoryAvatar';
import { openCreateEnvironmentModal } from '@/features/EnvironmentManager/CreateEnvironmentModal';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { refreshProjectFiles } from '@/services/projectFile';
import { sandboxStorageService } from '@/services/sandboxStorage';

import OptionRow from './OptionRow';
import SandboxDriveMenu, { type SandboxDriveFolderPick } from './SandboxDriveMenu';
import {
  environmentChipState,
  environmentSettingsPath,
  repositorySlug,
  selectionWithEnvironment,
} from './sandboxEnvironmentOptions';
import SandboxRepositoryMenu, { type SandboxRepositoryOption } from './SandboxRepositoryMenu';
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

/** A third level opens beside the second, the way the second opens beside the first. */
const SUBMENU_STYLES = {
  content: { padding: 4 },
  root: { height: 'auto', width: 'auto' },
};

const folderName = (path: string) => path.split('/').pop() || path;

/** What the folder of a selection is called: the root, its last segment, or a legacy directory's name. */
export const useSandboxFolderLabel = (selection: SandboxSelection, entitled: boolean) => {
  const { t } = useTranslation('chat');
  // A legacy environment directory's own row, for its name — from the
  // database, so the menu never waits on a sandbox.
  const { data: instance } = useSWR(
    entitled && selection.instanceId ? ['sandbox-drive-chip-instance', selection.instanceId] : null,
    () => sandboxStorageService.getInstance({ id: selection.instanceId! }),
  );
  if (selection.instanceId) return instance?.name ?? instance?.workingDirectory;
  if (selection.workingDirectory === '.') return t('sandboxDrive.root');
  return selection.workingDirectory ? folderName(selection.workingDirectory) : undefined;
};

interface CloudSandboxOptionsProps {
  /** Closes the whole execution-environment menu. */
  onClose: () => void;
  /** Moves the conversation to the cloud sandbox before an option is applied, when it is elsewhere. */
  onEnsureSandbox: () => Promise<void>;
  options: ReturnType<typeof useSandboxOptions>;
}

/**
 * The cloud sandbox's options, one level under its row in the
 * execution-environment menu:
 *
 * - **Storage** — one level further: a temporary sandbox (cleaned up with the
 *   session), or a folder of the drive;
 * - **Environment** — one level further: none, or the environment the run is
 *   set up from.
 *
 * Picking any option also moves the conversation to the cloud sandbox. A pick
 * that can no longer be honoured — the folder was deleted — is said at the
 * top, before the next message runs somewhere the person did not choose.
 */
const CloudSandboxOptions = memo<CloudSandboxOptionsProps>(
  ({ onClose, onEnsureSandbox, options }) => {
    const { t } = useTranslation(['chat', 'device']);
    const navigate = useWorkspaceAwareNavigate();
    const {
      driveStatus,
      entitled,
      environmentList,
      onDrive,
      onPublicDrive,
      pick,
      pickFolder: saveFolder,
      projectId,
      selection,
      sharedAgent,
      toTemporary,
      topicId,
      workspaceId,
    } = options;
    const {
      environments,
      failed: environmentsFailed,
      loaded: environmentsLoaded,
      refresh: refreshEnvironments,
    } = environmentList;
    const folderLabel = useSandboxFolderLabel(selection, entitled);

    // Whether the pick still holds, asked of the same resolver the run uses:
    // a folder deleted on a shared drive, or an environment directory gone,
    // sends the next run to a temporary sandbox — and the menu says so first.
    const { data: placement, mutate: revalidatePlacement } = useSWR(
      entitled && topicId && onDrive
        ? [
            'sandbox-drive-placement',
            topicId,
            selection.drive ?? '',
            selection.instanceId ?? '',
            selection.workingDirectory ?? '',
            selection.environmentId ?? '',
          ]
        : null,
      () => sandboxStorageService.resolveSessionPlacement({ topicId }),
      { revalidateOnFocus: true },
    );
    const fallback = placement?.fallback;

    const pickEnvironment = async (environment?: SandboxRepositoryOption) => {
      try {
        await onEnsureSandbox();
        await pick(selectionWithEnvironment(base, environment), { environment });
      } catch {
        // The topic kept its old placement; said rather than left looking picked.
        toast.error(t('sandboxEnvironment.saveFailed'));
        return;
      }
      // Picking what is already held keeps the keys unchanged, so SWR would go
      // on showing the old answers. Ask once more after every pick.
      void revalidatePlacement();
    };

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

    // An environment is only set up in an empty folder. Picking one that
    // already holds files keeps the files and skips the setup — said once, at
    // the pick, rather than left to look applied.
    const warnIfSetupSkipped = async (next: SandboxSelection) => {
      if (!next.environmentId || next.workingDirectory === undefined) return;
      try {
        const { entries = [] } = await sandboxStorageService.listFiles({
          drive: next.drive,
          path: next.workingDirectory === '.' ? undefined : next.workingDirectory,
        });
        if (entries.length > 0) toast.info(t('sandboxDrive.setupSkipped'));
      } catch {
        // A folder that cannot be listed yet is created empty on the first run.
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
      void warnIfSetupSkipped(next);
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

    // The drive state the environment is picked against: an entitlement lost
    // since the folder was picked leaves the conversation off the drive.
    const base: SandboxSelection = onDrive
      ? selection
      : selection.environmentId
        ? { environmentId: selection.environmentId }
        : {};

    const addEnvironment = () => {
      onClose();
      openCreateEnvironmentModal(
        // A workspace-public agent, or a folder on the public drive, applies
        // published environments only.
        sharedAgent || onPublicDrive ? 'public' : undefined,
        async (created) => {
          await refreshEnvironments();
          if (created?.id) await pickEnvironment(created);
        },
        t('sandboxEnvironment.add'),
      );
    };

    const current = environments.find((item) => item.id === selection.environmentId);
    const environmentState = environmentChipState({
      current,
      environmentId: selection.environmentId,
      failed: environmentsFailed,
      loaded: environmentsLoaded,
    });
    const environmentLabel =
      environmentState.kind === 'picked'
        ? environmentState.name
        : environmentState.kind === 'none'
          ? t('sandboxEnvironment.none')
          : environmentState.kind === 'missing'
            ? t('sandboxEnvironment.missing')
            : environmentState.kind === 'loadFailed'
              ? t('sandboxEnvironment.loadFailed')
              : t('sandboxEnvironment.loading');
    const slug = current && repositorySlug(current);

    const storageLabel = onDrive ? folderLabel : t('sandboxOptions.temporary');

    return (
      <Flexbox gap={2}>
        {fallback && (
          <Text className={stylex.props(styles.notice).className}>
            {t(`sandboxDrive.fallback.${fallback}`)}
          </Text>
        )}

        <Popover
          arrow={false}
          closeDelay={150}
          placement={'rightTop'}
          styles={SUBMENU_STYLES}
          trigger={['hover', 'click']}
          content={
            <SandboxDriveMenu
              entitled={driveStatus === 'hidden' ? undefined : driveStatus !== 'upgrade'}
              selectedLabel={onDrive ? folderLabel : undefined}
              temporary={!onDrive}
              // A legacy environment directory is not a folder of this list.
              selectedPath={
                onDrive && !selection.instanceId ? selection.workingDirectory : undefined
              }
              onBrowse={openBrowser}
              onPick={(folder) => void pickFolder(folder)}
              onPickTemporary={() => void pickTemporary()}
              onUpgrade={() => {
                onClose();
                openSandboxStorageUpsell();
              }}
            />
          }
        >
          <div data-testid={'sandbox-storage-row'}>
            <OptionRow
              arrow
              compact
              hint={storageLabel}
              label={t('sandboxOptions.storage')}
              icon={
                <Icon
                  icon={onDrive ? (selection.instanceId ? PackageIcon : FolderIcon) : TimerIcon}
                  size={16}
                />
              }
              onClick={() => {}}
            />
          </div>
        </Popover>

        <Popover
          arrow={false}
          closeDelay={150}
          placement={'rightTop'}
          styles={SUBMENU_STYLES}
          trigger={['hover', 'click']}
          content={
            <SandboxRepositoryMenu
              environments={environments}
              failed={environmentsFailed}
              loaded={environmentsLoaded}
              none={{ active: !selection.environmentId, onPick: () => void pickEnvironment() }}
              selectedId={selection.environmentId}
              // A project has exactly one environment, edited on its settings:
              // there is no second one to add from here.
              onAdd={projectId ? undefined : addEnvironment}
              onClose={onClose}
              onPick={pickEnvironment}
              onRetry={() => void refreshEnvironments()}
              onManage={() => {
                onClose();
                navigate(environmentSettingsPath(projectId));
              }}
            />
          }
        >
          <div data-testid={'sandbox-environment-row'}>
            <OptionRow
              arrow
              compact
              hint={environmentLabel}
              label={t('sandboxOptions.environment')}
              icon={
                slug ? (
                  <RepositoryAvatar size={16} url={slug} />
                ) : (
                  <Icon icon={selection.environmentId ? ContainerIcon : CircleOffIcon} size={16} />
                )
              }
              onClick={() => {}}
            />
          </div>
        </Popover>
      </Flexbox>
    );
  },
);

CloudSandboxOptions.displayName = 'CloudSandboxOptions';

export default CloudSandboxOptions;
