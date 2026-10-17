'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  ActionIcon,
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { MoreHorizontalIcon, PackageIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { describeError } from '@/features/EnvironmentManager/errorMessage';
import { useCanEditEnvironment } from '@/features/EnvironmentManager/useCanEditEnvironment';
import { environmentService } from '@/services/environment';
import { sandboxStorageService } from '@/services/sandboxStorage';

import type { DirectoryEntry, DirectoryListing, DirectorySource } from '../directorySource';
import EnvironmentSelect from '../EnvironmentSelect';
import { openRenameFolderModal } from '../RenameFolderModal';
import {
  displayDrivePath,
  driveParentPath,
  environmentDirectoriesByPath,
  environmentDirectoryState,
  joinDrivePath,
} from './driveFolders';

/** How often a building environment directory is re-listed while the picker shows it. */
const BUILD_REFRESH_MS = 4000;

const FOLDERS_KEY = 'sandbox-drive-folders';

export interface UseSandboxDirectorySourceOptions {
  /**
   * The conversation's agent is shared with the workspace. Such an agent runs
   * on its caller's session, so it cannot run in a private environment's
   * directory — those rows are offered disabled, with the reason.
   */
  agentIsPublic?: boolean;
  /** Which of the caller's drives is browsed; a personal account's is `personal`. */
  drive: SandboxDrive;
  /**
   * The conversation is in a workspace, which has a public drive beside each
   * member's personal one. The public drive's root holds every member's
   * folders, so the root itself is not a folder anyone may work in there.
   */
  isWorkspace: boolean;
  /**
   * An environment directory was picked, or just initialized from a new
   * folder, on the drive named — which is the environment's, not
   * necessarily the one being browsed.
   */
  onPickInstance: (instanceId: string, drive: SandboxDrive) => void;
  /** Whose run the occupancy answers are relative to; the conversation's own. */
  topicId?: string;
}

/**
 * The cloud sandbox's drive as a directory source, read through
 * `sandboxStorage.listFiles` and written through `createDirectory`.
 *
 * Its root holds two kinds of folder side by side. Ordinary folders are browsed,
 * picked, created, renamed and deleted like any other. Environment directories
 * — folders initialized from a code environment — carry a badge, are picked
 * as a whole by clicking them (binding the conversation to the instance), and
 * are read-only from here; one another conversation is running in says so and
 * offers a fresh copy instead.
 *
 * In a workspace a private environment's directory is made on the member's
 * personal drive and a published one's on the public drive, so the
 * initialize-from offer on each drive lists only the environments whose
 * directories belong there. A private environment's directory still on the
 * public drive, from before personal drives, is hidden there by the server;
 * its owner hears about it on the environment's page, not here — picking a
 * folder is not the moment to sort out an old one.
 */
export const useSandboxDirectorySource = ({
  agentIsPublic,
  drive,
  isWorkspace,
  onPickInstance,
  topicId,
}: UseSandboxDirectorySourceOptions): DirectorySource => {
  const { t } = useTranslation(['device', 'setting', 'common']);
  const canEdit = useCanEditEnvironment();
  const workspaceId = useActiveWorkspaceId();
  const { mutate: globalMutate } = useSWRConfig();

  return useMemo(() => {
    const isSharedDrive = isWorkspace && drive === 'public';
    // Which environments may initialize a folder on this drive: the ones whose
    // directories are made here, and only the caller's own.
    const initializable = (environment: Parameters<typeof canEdit>[0]) =>
      canEdit(environment) &&
      (!isWorkspace ||
        (drive === 'personal'
          ? environment.visibility === 'private'
          : environment.visibility === 'public'));
    const tSetting = (key: string, options?: Record<string, unknown>) =>
      (t as (key: string, options?: Record<string, unknown>) => string)(key, {
        ...options,
        ns: 'setting',
      });
    const refreshFolders = () =>
      globalMutate((key) => Array.isArray(key) && key[0] === FOLDERS_KEY);
    const failed = (error: unknown) =>
      toast.error(describeError(error, tSetting, t('workingDirectory.drive.actionFailed')));

    /** A new instance of the environment, built from its definition, for this conversation. */
    const createCopy = async (environmentId: string) => {
      try {
        const created = await sandboxStorageService.createInstanceForEnvironment({ environmentId });
        void sandboxStorageService.startInstanceBuild({ id: created.id, topicId }).catch(failed);
        // Beside the one it copies, on the drive being browsed.
        onPickInstance(created.id, drive);
      } catch (error) {
        failed(error);
      }
    };

    const renameFolder = (entry: { name: string; path: string }) =>
      openRenameFolderModal({
        currentName: entry.name,
        onSubmit: async (name) => {
          try {
            await sandboxStorageService.renameFile({
              drive,
              newPath: joinDrivePath(driveParentPath(entry.path) ?? '', name),
              path: entry.path,
            });
            await refreshFolders();
          } catch (error) {
            return describeError(error, tSetting, t('workingDirectory.drive.renameFailed'));
          }
        },
      });

    const deleteFolder = (entry: { name: string; path: string }) =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('workingDirectory.drive.deleteConfirmContent'),
        okButtonProps: { danger: true },
        okText: t('workingDirectory.drive.delete'),
        onOk: async () => {
          try {
            await sandboxStorageService.removeFile({ drive, path: entry.path, recursive: true });
            await refreshFolders();
          } catch (error) {
            failed(error);
          }
        },
        title: t('workingDirectory.drive.deleteConfirmTitle', { name: entry.name }),
      });

    // One menu rather than a pair of icons: the row is for picking, and what
    // else can be done to a folder stays one click away without competing.
    const folderActions = (entry: { name: string; path: string }) => (
      <span
        role={'none'}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenu
          placement={'bottomRight'}
          items={[
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'rename',
              label: t('workingDirectory.drive.rename'),
              onClick: () => renameFolder(entry),
            },
            {
              danger: true,
              icon: <Icon icon={Trash2Icon} />,
              key: 'delete',
              label: t('workingDirectory.drive.delete'),
              onClick: () => deleteFolder(entry),
            },
          ]}
        >
          <ActionIcon
            aria-label={t('workingDirectory.drive.moreActions')}
            icon={MoreHorizontalIcon}
            size={'small'}
          />
        </DropdownMenu>
      </span>
    );

    return {
      createFolder: async (parentPath, name, options) => {
        const environmentId = options?.environmentId as string | undefined;
        if (environmentId) {
          // Always at the root, whatever folder is being browsed: environment
          // directories sit side by side there. On the environment's own
          // drive, which the offer above already keeps to this one.
          const created = await sandboxStorageService.createInstance({
            environmentId,
            name,
            workingDirectory: name,
          });
          void sandboxStorageService.startInstanceBuild({ id: created.id, topicId }).catch(failed);
          void refreshFolders();
          onPickInstance(created.id, created.drive);

          return { path: name };
        }

        const path = joinDrivePath(parentPath, name);
        await sandboxStorageService.createDirectory({ drive, path });

        return { path };
      },
      displayPath: displayDrivePath,
      editablePath: false,
      folderErrorKey: (error) => {
        const code = (error as { message?: string })?.message;
        if (code === 'FOLDER_NOT_EMPTY') return 'workingDirectory.drive.folderNotEmpty';
        if (code === 'DUPLICATE_INSTANCE_DIRECTORY' || code === 'OVERLAPPING_INSTANCE_DIRECTORY')
          return 'workingDirectory.drive.folderTaken';
        if (code === 'INSTANCE_READ_ONLY') return 'workingDirectory.drive.readOnly';
      },
      listErrorKey: 'workingDirectory.drive.foldersLoadFailed',
      rootLabel: t(`workingDirectory.drive.drives.${drive}`),
      renderNewFolderOptions: ({ onChange, value }) => (
        <Flexbox gap={4}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {t('workingDirectory.drive.initializeWith')}
            </Text>
            <EnvironmentSelect
              filter={initializable}
              value={value.environmentId as string | undefined}
              onChange={(environmentId) => onChange({ environmentId })}
            />
          </Flexbox>
          {!!value.environmentId && (
            <Text fontSize={12} type={'secondary'}>
              {t('workingDirectory.drive.initializeHint')}
            </Text>
          )}
        </Flexbox>
      ),
      selectBlockedReason: (path) =>
        isSharedDrive && !path ? t('workingDirectory.drive.rootNotAllowed') : undefined,
      useListing: (path?: string): DirectoryListing => {
        const listingPath = path ?? '';
        const isRoot = !listingPath;

        const folders = useSWR(
          [FOLDERS_KEY, workspaceId ?? '', drive, listingPath],
          () => sandboxStorageService.listFiles({ drive, path: listingPath || undefined }),
          { revalidateOnFocus: false, shouldRetryOnError: false },
        );
        const instances = useSWR(
          isRoot ? ['sandbox-drive-instances', workspaceId ?? '', drive, topicId ?? ''] : null,
          () => sandboxStorageService.listInstances({ drive, topicId, withSizes: false }),
          {
            refreshInterval: (latest) => {
              const listed = latest?.instances ?? [];

              return listed.some((instance) => instance.status === 'pending')
                ? BUILD_REFRESH_MS
                : 0;
            },
            revalidateOnFocus: false,
          },
        );
        const environments = useSWR(
          isRoot ? ['sandbox-drive-environments', workspaceId ?? ''] : null,
          () => environmentService.listEnvironments(),
          { revalidateOnFocus: false },
        );

        const environmentById = new Map(
          (environments.data?.environments ?? []).map((environment) => [
            environment.id,
            environment,
          ]),
        );
        const listed = instances.data?.instances ?? [];
        const directories = environmentDirectoriesByPath(
          listingPath,
          listed.filter((instance) => !instance.rebuildRequired),
        );

        const entries: DirectoryEntry[] = (folders.data?.entries ?? [])
          .filter((entry) => entry.isDirectory)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry) => {
            const instance = directories.get(entry.path);
            if (!instance) {
              return { actions: folderActions(entry), name: entry.name, path: entry.path };
            }

            const environment = environmentById.get(instance.environmentId);
            const state = environmentDirectoryState(instance);
            const blocked =
              !!agentIsPublic && !!environment?.workspaceId && environment.visibility === 'private';

            // The way out of "in use" sits on the row's second line rather
            // than among its tags: the right edge is where hover actions
            // overlay a row, and a button under them never gets the click.
            const copyable = state === 'inUse' && !!environment && canEdit(environment);

            return {
              description: blocked ? (
                t('workingDirectory.drive.privateBlocked')
              ) : state === 'inUse' ? (
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('workingDirectory.drive.inUseDesc')}
                  </Text>
                  {copyable && environment && (
                    <Button
                      size={'small'}
                      onClick={(event) => {
                        event.stopPropagation();
                        void createCopy(environment.id);
                      }}
                    >
                      {t('workingDirectory.drive.createCopy')}
                    </Button>
                  )}
                </Flexbox>
              ) : undefined,
              disabled: blocked,
              icon: PackageIcon,
              name: entry.name,
              // Picked as a whole: the directory and what its build installed
              // are one choice, and browsing into it would offer its insides
              // as folders of their own.
              onActivate: () => {
                if (state === 'inUse') {
                  toast.info(t('workingDirectory.drive.inUseDesc'));
                  return;
                }
                onPickInstance(instance.id, drive);
              },
              path: entry.path,
              tags: (
                <Flexbox horizontal align={'center'} gap={4}>
                  {/* Which environment built it, not merely that one did: the
                      folder's own name is already the row's title. */}
                  <Tag icon={<Icon icon={PackageIcon} size={12} />} size={'small'}>
                    {environment?.name && environment.name !== entry.name
                      ? environment.name
                      : t('workingDirectory.drive.environmentBadge')}
                  </Tag>
                  {state !== 'ready' && (
                    <Tag color={state === 'failed' ? 'error' : 'warning'} size={'small'}>
                      {t(`workingDirectory.drive.state.${state}`)}
                    </Tag>
                  )}
                </Flexbox>
              ),
            } satisfies DirectoryEntry;
          });

        return {
          directory: folders.data
            ? { parentPath: driveParentPath(listingPath), path: listingPath }
            : undefined,
          entries,
          error: folders.error,
          hasMore: false,
          isLoading: folders.isLoading || (isRoot && instances.isLoading),
          isLoadingMore: false,
          isRefreshing: folders.isValidating && !folders.isLoading,
          loadMore: () => {},
          refresh: async () => {
            await Promise.all([folders.mutate(), instances.mutate()]);
          },
          retry: () => void folders.mutate(),
        };
      },
    } satisfies DirectorySource;
  }, [
    agentIsPublic,
    canEdit,
    drive,
    globalMutate,
    isWorkspace,
    onPickInstance,
    t,
    topicId,
    workspaceId,
  ]);
};
