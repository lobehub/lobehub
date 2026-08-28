import { CUSTOM_FOLDER_FILE_TYPE, DERIVED_DOCUMENT_SOURCE_TYPE } from '@lobechat/const';
import type { SFSymbol } from '@lobechat/electron-client-ipc';
import { copyToClipboard, Icon, Tooltip } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { type ItemType } from 'antd/es/menu/interface';
import {
  BookMinusIcon,
  BookPlusIcon,
  DownloadIcon,
  EyeOffIcon,
  FolderInputIcon,
  GlobeIcon,
  LinkIcon,
  PencilIcon,
  Trash,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import RepoIcon from '@/components/LibIcon';
import { useSendToMessengerMenuItem } from '@/features/Messenger/PushResourceModal/useSendToMessengerMenuItem';
import { useKnowledgeBaseListContext } from '@/features/ResourceManager/components/KnowledgeBaseListProvider';
import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { documentService } from '@/services/document';
import { useFileStore } from '@/store/file';
import { useKnowledgeBaseStore } from '@/store/library';
import { useTreeStore } from '@/store/tree';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { downloadFile } from '@/utils/client/downloadFile';
import { isForbiddenError } from '@/utils/forbiddenError';

import { openMoveToFolderModal } from '../MoveToFolderModal';

interface UseFileItemDropdownParams {
  enabled?: boolean;
  /**
   * The underlying `files.id` when the row is a file. The unified resource
   * list addresses a file that backs a derived page by the PAGE id
   * (`COALESCE(d.id, f.id)` in KnowledgeRepo), so `id` alone cannot be used
   * for file-table lookups such as the messenger push.
   */
  fileId?: string | null;
  filename: string;
  fileType: string;
  id: string;
  libraryId?: string;
  onRenameStart?: () => void;
  /** Byte size when available — powers the push modal's oversize pre-warning. */
  size?: number;
  sourceType?: string;
  url: string;
  userId?: string | null;
  visibility?: 'private' | 'public' | null;
}

type FileMenuItem = ItemType & { sfSymbol?: SFSymbol };

interface UseFileItemDropdownReturn {
  menuItems: () => FileMenuItem[];
}

/**
 * Shared with folder tree and explorer
 */
export const useFileItemDropdown = ({
  fileId,
  id,
  libraryId,
  url,
  filename,
  fileType,
  size,
  sourceType,
  onRenameStart,
  userId,
  visibility,
}: UseFileItemDropdownParams): UseFileItemDropdownReturn => {
  const { t } = useTranslation(['components', 'common', 'knowledgeBase', 'chat']);

  const appOrigin = useAppOrigin();
  const { allowed: canEditResources } = usePermission('edit_own_content');
  const currentUserId = useUserStore(userProfileSelectors.userId);
  // Row-level ownership: only the creator or a workspace owner may rename or
  // delete a shared resource — mirrors the server-side enforcement.
  const canManage = useResourceManageable(userId);

  const {
    deleteResource,
    moveResource,
    refreshFileList,
    publishFileToWorkspace,
    setFileVisibility,
  } = useFileStore(
    (s) => ({
      deleteResource: s.deleteResource,
      moveResource: s.moveResource,
      publishFileToWorkspace: s.publishFileToWorkspace,
      refreshFileList: s.refreshFileList,
      setFileVisibility: s.setFileVisibility,
    }),
    shallow,
  );
  const [removeFilesFromKnowledgeBase, addFilesToKnowledgeBase] = useKnowledgeBaseStore((s) => [
    s.removeFilesFromKnowledgeBase,
    s.addFilesToKnowledgeBase,
  ]);
  const libraries = useKnowledgeBaseListContext();

  const isInLibrary = !!libraryId;
  const isFolder = fileType === CUSTOM_FOLDER_FILE_TYPE;
  // PDF and Office files should not be treated as pages
  const lowerFilename = filename?.toLowerCase();
  const isPDF = fileType?.toLowerCase() === 'pdf' || lowerFilename?.endsWith('.pdf');
  const isOfficeFile =
    lowerFilename?.endsWith('.xls') ||
    lowerFilename?.endsWith('.xlsx') ||
    lowerFilename?.endsWith('.doc') ||
    lowerFilename?.endsWith('.docx') ||
    lowerFilename?.endsWith('.ppt') ||
    lowerFilename?.endsWith('.pptx') ||
    lowerFilename?.endsWith('.odt');
  const isPage =
    !isPDF &&
    !isOfficeFile &&
    (sourceType === DERIVED_DOCUMENT_SOURCE_TYPE || fileType === PAGE_FILE_TYPE);

  // Pages/documents have no storage URL to attach, so only real files get the
  // "Send to chat platform" entry. The server resolves the attachment by
  // `files.id`, but a file that backs a derived page is listed under the PAGE
  // id — always prefer the row's underlying `fileId` when it carries one.
  const sendToMessengerItem = useSendToMessengerMenuItem({
    enabled: !isFolder && !isPage && !!url,
    file: { fileType, id: fileId ?? id, name: filename, size },
  });

  const menuItems = useCallback(() => {
    // Filter out current knowledge base and constrain by visibility scope:
    // a private file can only join a private KB, a workspace-public file can
    // only join a public KB. Personal-mode files (visibility null/undefined)
    // ignore the scope filter.
    const availableKnowledgeBases = libraries.filter((kb) => {
      if (kb.id === libraryId) return false;
      if (visibility === 'private' || visibility === 'public') {
        return kb.visibility === visibility;
      }
      return true;
    });

    // Submenu for adding files to a library (used when NOT in a library)
    const addToKnowledgeBaseSubmenu: ItemType[] = availableKnowledgeBases.map((kb) => ({
      icon: <RepoIcon />,
      key: `add-to-library-${kb.id}`,
      label: <span style={{ marginLeft: 8 }}>{kb.name}</span>,
      onClick: async ({ domEvent }) => {
        domEvent.stopPropagation();
        try {
          await addFilesToKnowledgeBase(kb.id, [id]);
          toast.success(
            t('addToKnowledgeBase.addSuccess', {
              count: 1,
              ns: 'knowledgeBase',
            }),
          );
        } catch (e: any) {
          console.error(e);
          // Check for duplicate key error (file already exists in the library)
          // Server throws CONFLICT error code for duplicate entries
          const isDuplicateError =
            e?.data?.code === 'CONFLICT' || e?.message === 'FILE_ALREADY_IN_KNOWLEDGE_BASE';
          if (isDuplicateError) {
            toast.warning(t('addToKnowledgeBase.alreadyExists', { ns: 'knowledgeBase' }));
          } else {
            toast.error(t('addToKnowledgeBase.error', { ns: 'knowledgeBase' }));
          }
        }
      },
    }));

    // Submenu for moving files to another library (used when IN a library)
    // Move = remove from current library + clear folder relationship + add to target library
    const moveToKnowledgeBaseSubmenu: ItemType[] = availableKnowledgeBases.map((kb) => ({
      icon: <RepoIcon />,
      key: `move-to-library-${kb.id}`,
      label: <span style={{ marginLeft: 8 }}>{kb.name}</span>,
      onClick: async ({ domEvent }) => {
        domEvent.stopPropagation();
        try {
          // First remove from current library
          if (libraryId) {
            await removeFilesFromKnowledgeBase(libraryId, [id]);
          }
          // Clear folder relationship (parentId) since folders are library-specific
          await moveResource(id, null);
          // Then add to target library
          await addFilesToKnowledgeBase(kb.id, [id]);
          toast.success(t('moveToKnowledgeBase.success', { ns: 'knowledgeBase' }));
        } catch (e: any) {
          console.error(e);
          const isDuplicateError =
            e?.data?.code === 'CONFLICT' || e?.message === 'FILE_ALREADY_IN_KNOWLEDGE_BASE';
          if (isDuplicateError) {
            toast.warning(t('addToKnowledgeBase.alreadyExists', { ns: 'knowledgeBase' }));
          } else {
            toast.error(t('moveToKnowledgeBase.error', { ns: 'knowledgeBase' }));
          }
        }
      },
    }));

    const libraryRelatedActions = (
      !canEditResources
        ? []
        : isInLibrary
          ? [
              availableKnowledgeBases.length > 0 && {
                children: moveToKnowledgeBaseSubmenu,
                icon: <Icon icon={BookPlusIcon} />,
                key: 'moveToOtherLibrary',
                label: t('FileManager.actions.moveToOtherLibrary'),
              },
              {
                icon: <Icon icon={BookMinusIcon} />,
                key: 'removeFromLibrary',
                label: t('FileManager.actions.removeFromLibrary'),
                onClick: async ({ domEvent }) => {
                  domEvent.stopPropagation();

                  confirmModal({
                    cancelText: t('cancel', { ns: 'common' }),
                    content: t('FileManager.actions.confirmRemoveFromLibrary', {
                      count: 1,
                    }),
                    okButtonProps: {
                      danger: true,
                    },
                    okText: t('FileManager.actions.removeFromLibrary'),
                    onOk: async () => {
                      await removeFilesFromKnowledgeBase(libraryId, [id]);

                      toast.success(t('FileManager.actions.removeFromLibrarySuccess'));
                    },
                    title: t('FileManager.actions.removeFromLibrary'),
                  });
                },
              },
            ]
          : [
              availableKnowledgeBases.length > 0 && {
                children: addToKnowledgeBaseSubmenu,
                icon: <Icon icon={BookPlusIcon} />,
                key: 'addToLibrary',
                label: t('FileManager.actions.addToLibrary'),
              },
            ]
    ) as ItemType[];

    const hasKnowledgeBaseActions = libraryRelatedActions.some(Boolean);

    // Only the creator of a still-private file (not a folder, since folders
    // live in the `documents` table and have their own publish flow) sees the
    // "Publish to workspace" entry. Mirrors the agent / task one-way publish.
    const isOwnPrivateFile =
      sourceType !== DERIVED_DOCUMENT_SOURCE_TYPE &&
      !isFolder &&
      visibility === 'private' &&
      !!currentUserId &&
      userId === currentUserId;
    // Bidirectional counterpart: workspace-public files owned by the caller
    // can be pulled back to private via the same guarded server path.
    const isOwnPublicFile =
      sourceType !== DERIVED_DOCUMENT_SOURCE_TYPE &&
      !isFolder &&
      visibility === 'public' &&
      !!currentUserId &&
      userId === currentUserId;

    return (
      [
        canEditResources &&
          isOwnPrivateFile && {
            icon: <Icon icon={GlobeIcon} />,
            key: 'publishToWorkspace',
            label: t('resources.publishToWorkspace.menu', { ns: 'chat' }),
            onClick: async ({ domEvent }) => {
              domEvent.stopPropagation();
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                content: <VisibilityConfirmContent variant="publish" />,
                okText: t('continue', { ns: 'common' }),
                title: t('resources.publishToWorkspace.menu', { ns: 'chat' }),
                onOk: async () => {
                  try {
                    await publishFileToWorkspace(id);
                    toast.success(t('resources.publishToWorkspace.success', { ns: 'chat' }));
                  } catch (error) {
                    console.error(error);
                    toast.error(t('resources.publishToWorkspace.error', { ns: 'chat' }));
                  }
                },
              });
            },
          },
        canEditResources && isOwnPrivateFile && { type: 'divider' },
        canEditResources &&
          isOwnPublicFile && {
            icon: <Icon icon={EyeOffIcon} />,
            key: 'makePrivate',
            label: t('makePrivate', { ns: 'common' }),
            onClick: async ({ domEvent }) => {
              domEvent.stopPropagation();
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                content: <VisibilityConfirmContent variant="makePrivate" />,
                okButtonProps: { danger: true },
                okText: t('continue', { ns: 'common' }),
                title: t('makePrivate.confirm.title', { ns: 'common' }),
                onOk: async () => {
                  try {
                    await setFileVisibility(id, 'private');
                    toast.success(t('makePrivate.success', { ns: 'common' }));
                  } catch (error) {
                    console.error(error);
                    toast.error(t('makePrivate.error', { ns: 'common' }));
                  }
                },
              });
            },
          },
        canEditResources && isOwnPublicFile && { type: 'divider' },
        {
          icon: <Icon icon={LinkIcon} />,
          key: 'copyUrl',
          label: t('FileManager.actions.copyUrl'),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();

            // For pages, use the route path instead of the storage URL
            let urlToCopy = url;
            if (isPage) {
              if (libraryId) {
                urlToCopy = `${appOrigin}/resource/library/${libraryId}?file=${id}`;
              } else {
                urlToCopy = `${appOrigin}/resource?file=${id}`;
              }
            }

            await copyToClipboard(urlToCopy);
            toast.success(t('FileManager.actions.copyUrlSuccess'));
          },
          sfSymbol: 'doc.on.doc',
        },
        !isFolder && {
          icon: <Icon icon={DownloadIcon} />,
          key: 'download',
          label: t('download', { ns: 'common' }),
          sfSymbol: 'square.and.arrow.down',
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();
            const downloadingToast = toast.loading(t('FileManager.actions.downloading'));

            if (isPage) {
              // For pages, download as markdown
              try {
                const doc = await documentService.getDocumentById(id);
                if (doc?.content) {
                  // Add title as markdown heading
                  const title = doc.title || filename;
                  const contentWithTitle = `# ${title}\n\n${doc.content}`;

                  // Create a blob with the markdown content including title
                  const blob = new Blob([contentWithTitle], { type: 'text/markdown' });
                  const blobUrl = URL.createObjectURL(blob);

                  // Ensure filename has .md extension
                  const mdFilename = filename.endsWith('.md') ? filename : `${filename}.md`;

                  await downloadFile(blobUrl, mdFilename);
                  URL.revokeObjectURL(blobUrl);
                } else {
                  toast.error('Failed to download page: no content available');
                }
              } catch (error) {
                console.error('Failed to download page:', error);
                toast.error('Failed to download page');
              }
            } else {
              // For regular files, download from URL
              await downloadFile(url, filename);
            }

            downloadingToast.close();
          },
        },
        sendToMessengerItem,
        (hasKnowledgeBaseActions || (canEditResources && (isInLibrary || isFolder))) && {
          type: 'divider',
        },
        ...libraryRelatedActions,
        canEditResources &&
          isInLibrary && {
            icon: <Icon icon={FolderInputIcon} />,
            key: 'moveToFolder',
            label: t('FileManager.actions.moveToFolder'),
            onClick: async ({ domEvent }) => {
              domEvent.stopPropagation();

              openMoveToFolderModal({
                fileId: id,
                knowledgeBaseId: libraryId,
              });
            },
          },
        canEditResources &&
          isFolder && {
            disabled: !canManage,
            icon: <Icon icon={PencilIcon} />,
            key: 'rename',
            label: canManage ? (
              t('FileManager.actions.rename')
            ) : (
              <Tooltip title={t('manageOnlyCreator', { ns: 'common' })}>
                <span>{t('FileManager.actions.rename')}</span>
              </Tooltip>
            ),
            onClick: async ({ domEvent }) => {
              domEvent.stopPropagation();
              if (!canManage) return;
              onRenameStart?.();
            },
            sfSymbol: 'pencil',
          },
        canEditResources && {
          type: 'divider',
        },
        canEditResources && {
          danger: true,
          disabled: !canManage,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: canManage ? (
            t('delete', { ns: 'common' })
          ) : (
            <Tooltip title={t('manageOnlyCreator', { ns: 'common' })}>
              <span>{t('delete', { ns: 'common' })}</span>
            </Tooltip>
          ),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();
            if (!canManage) return;
            confirmModal({
              content: isFolder
                ? t('FileManager.actions.confirmDeleteFolder')
                : t('FileManager.actions.confirmDelete'),
              okButtonProps: { danger: true },
              title: t('delete', { ns: 'common' }),
              onOk: async () => {
                try {
                  // Use optimistic delete - instant UI update, sync in background
                  await deleteResource(id);

                  // Revalidate tree for the parent folder
                  const { queryParams } = useFileStore.getState();
                  const parentId = queryParams?.parentId ?? '';
                  void useTreeStore.getState().revalidate(parentId);
                  await refreshFileList({ revalidateResources: false });

                  toast.success(t('FileManager.actions.deleteSuccess'));
                } catch (error) {
                  toast.error(
                    isForbiddenError(error)
                      ? t('manageOnlyCreator', { ns: 'common' })
                      : t('operationFailed', { ns: 'common' }),
                  );
                }
              },
            });
          },
          sfSymbol: 'trash',
        },
      ] as FileMenuItem[]
    ).filter(Boolean);
  }, [
    addFilesToKnowledgeBase,
    appOrigin,
    canEditResources,
    canManage,
    currentUserId,
    deleteResource,
    filename,
    id,
    isFolder,
    isInLibrary,
    isPage,
    libraries,
    libraryId,
    moveResource,
    onRenameStart,
    publishFileToWorkspace,
    setFileVisibility,
    refreshFileList,
    removeFilesFromKnowledgeBase,
    sendToMessengerItem,
    sourceType,
    t,
    url,
    userId,
    visibility,
  ]);

  return { menuItems };
};
