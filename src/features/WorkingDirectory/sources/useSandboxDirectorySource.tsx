'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { ActionIcon, confirmModal, DropdownMenu, Icon, Tag, toast } from '@lobehub/ui';
import { FolderGit2Icon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { describeError } from '@/features/EnvironmentManager/errorMessage';
import { sandboxStorageService } from '@/services/sandboxStorage';

import type { DirectoryEntry, DirectoryListing, DirectorySource } from '../directorySource';
import { openRenameFolderModal } from '../RenameFolderModal';
import { displayDrivePath, driveParentPath, joinDrivePath } from './driveFolders';

const FOLDERS_KEY = 'sandbox-drive-folders';

export interface UseSandboxDirectorySourceOptions {
  /** Which of the caller's drives is browsed; a personal account's is `personal`. */
  drive: SandboxDrive;
  /**
   * The conversation is in a workspace, which has a public drive beside each
   * member's personal one. The public drive's root holds every member's
   * folders, so the root itself is not a folder anyone may work in there.
   */
  isWorkspace: boolean;
}

/**
 * The cloud sandbox's drive as a directory source, read through
 * `sandboxStorage.listFiles` and written through `createDirectory`.
 *
 * Every folder is an ordinary folder: browsed, picked, created, renamed and
 * deleted alike. One a code environment initialized is no different — an
 * environment is a one-time initializer, and what it leaves is a checkout —
 * so the only thing said about a folder is whether it is a git repository.
 */
export const useSandboxDirectorySource = ({
  drive,
  isWorkspace,
}: UseSandboxDirectorySourceOptions): DirectorySource => {
  const { t } = useTranslation(['device', 'setting', 'common']);
  const workspaceId = useActiveWorkspaceId();
  const { mutate: globalMutate } = useSWRConfig();

  return useMemo(() => {
    const isSharedDrive = isWorkspace && drive === 'public';
    const tSetting = (key: string, options?: Record<string, unknown>) =>
      (t as (key: string, options?: Record<string, unknown>) => string)(key, {
        ...options,
        ns: 'setting',
      });
    const refreshFolders = () =>
      globalMutate((key) => Array.isArray(key) && key[0] === FOLDERS_KEY);
    const failed = (error: unknown) =>
      toast.error(describeError(error, tSetting, t('workingDirectory.drive.actionFailed')));

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
      createFolder: async (parentPath, name) => {
        const path = joinDrivePath(parentPath, name);
        await sandboxStorageService.createDirectory({ drive, path });

        return { path };
      },
      displayPath: displayDrivePath,
      editablePath: false,
      folderErrorKey: (error) => {
        const code = (error as { message?: string })?.message;
        if (code === 'FOLDER_NOT_EMPTY') return 'workingDirectory.drive.folderNotEmpty';
      },
      listErrorKey: 'workingDirectory.drive.foldersLoadFailed',
      selectBlockedReason: (path) =>
        isSharedDrive && !path ? t('workingDirectory.drive.rootNotAllowed') : undefined,
      useListing: (path?: string): DirectoryListing => {
        const listingPath = path ?? '';

        const folders = useSWR(
          [FOLDERS_KEY, workspaceId ?? '', drive, listingPath],
          () => sandboxStorageService.listFiles({ drive, path: listingPath || undefined }),
          { revalidateOnFocus: false, shouldRetryOnError: false },
        );

        const entries: DirectoryEntry[] = (folders.data?.entries ?? [])
          .filter((entry) => entry.isDirectory)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry) => ({
            actions: folderActions(entry),
            name: entry.name,
            path: entry.path,
            ...(entry.isGitRepository && {
              icon: FolderGit2Icon,
              tags: <Tag size={'small'}>{t('workingDirectory.drive.gitRepository')}</Tag>,
            }),
          }));

        return {
          directory: folders.data
            ? { parentPath: driveParentPath(listingPath), path: listingPath }
            : undefined,
          entries: folders.error ? [] : entries,
          error: folders.error,
          hasMore: false,
          isLoading: folders.isLoading,
          isLoadingMore: false,
          isRefreshing: folders.isValidating && !folders.isLoading,
          loadMore: () => {},
          refresh: async () => {
            await folders.mutate();
          },
          retry: () => void folders.mutate(),
        };
      },
    } satisfies DirectorySource;
  }, [drive, globalMutate, isWorkspace, t, workspaceId]);
};
