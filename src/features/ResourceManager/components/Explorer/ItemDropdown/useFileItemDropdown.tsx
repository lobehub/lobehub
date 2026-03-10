import { copyToClipboard, createRawModal, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { type ItemType } from 'antd/es/menu/interface';
import {
  BookMinusIcon,
  BookPlusIcon,
  DownloadIcon,
  FolderInputIcon,
  LinkIcon,
  PencilIcon,
  Trash,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import RepoIcon from '@/components/LibIcon';
import { clearTreeFolderCache } from '@/features/ResourceManager/components/LibraryHierarchy';
import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { documentService } from '@/services/document';
import { useFileStore } from '@/store/file';
import { useKnowledgeBaseStore } from '@/store/library';
import { downloadFile } from '@/utils/client/downloadFile';

import MoveToFolderModal from '../MoveToFolderModal';

interface UseFileItemDropdownParams {
  enabled?: boolean;
  filename: string;
  fileType: string;
  id: string;
  libraryId?: string;
  onRenameStart?: () => void;
  sourceType?: string;
  url: string;
}

interface UseFileItemDropdownReturn {
  menuItems: () => ItemType[];
}

/**
 * Shared with folder tree and explorer
 */
export const useFileItemDropdown = ({
  id,
  libraryId,
  url,
  filename,
  fileType,
  sourceType,
  onRenameStart,
}: UseFileItemDropdownParams): UseFileItemDropdownReturn => {
  const { t } = useTranslation(['components', 'common', 'knowledgeBase']);
  const { message, modal } = App.useApp();
  const appOrigin = useAppOrigin();

  const { deleteResource, moveResource, refreshFileList } = useFileStore(
    (s) => ({
      deleteResource: s.deleteResource,
      moveResource: s.moveResource,
      refreshFileList: s.refreshFileList,
    }),
    shallow,
  );
  const [removeFilesFromKnowledgeBase, addFilesToKnowledgeBase, useFetchKnowledgeBaseList] =
    useKnowledgeBaseStore((s) => [
      s.removeFilesFromKnowledgeBase,
      s.addFilesToKnowledgeBase,
      s.useFetchKnowledgeBaseList,
    ]);

  // Fetch knowledge bases - SWR caches this across all dropdown instances
  // Only the first call fetches from server, subsequent calls use cache
  // The expensive menu computation is deferred until dropdown opens (menuItems is a function)
  const { data: libraries } = useFetchKnowledgeBaseList();

  const isInLibrary = !!libraryId;
  const isFolder = fileType === 'custom/folder';
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
    !isPDF && !isOfficeFile && (sourceType === 'document' || fileType === PAGE_FILE_TYPE);

  const menuItems = useCallback(() => {
    // Filter out current knowledge base and create submenu items
    const availableKnowledgeBases = (libraries || []).filter((kb) => kb.id !== libraryId);

    // Submenu for adding files to a library (used when NOT in a library)
    const addToKnowledgeBaseSubmenu: ItemType[] = availableKnowledgeBases.map((kb) => ({
      icon: <RepoIcon />,
      key: `add-to-library-${kb.id}`,
      label: <span style={{ marginLeft: 8 }}>{kb.name}</span>,
      onClick: async ({ domEvent }) => {
        domEvent.stopPropagation();
        try {
          await addFilesToKnowledgeBase(kb.id, [id]);
          message.success(
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
            message.warning(t('addToKnowledgeBase.alreadyExists', { ns: 'knowledgeBase' }));
          } else {
            message.error(t('addToKnowledgeBase.error', { ns: 'knowledgeBase' }));
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
          message.success(t('moveToKnowledgeBase.success', { ns: 'knowledgeBase' }));
        } catch (e: any) {
          console.error(e);
          const isDuplicateError =
            e?.data?.code === 'CONFLICT' || e?.message === 'FILE_ALREADY_IN_KNOWLEDGE_BASE';
          if (isDuplicateError) {
            message.warning(t('addToKnowledgeBase.alreadyExists', { ns: 'knowledgeBase' }));
          } else {
            message.error(t('moveToKnowledgeBase.error', { ns: 'knowledgeBase' }));
          }
        }
      },
    }));

    const libraryRelatedActions = (
      isInLibrary
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

                modal.confirm({
                  okButtonProps: {
                    danger: true,
                  },
                  onOk: async () => {
                    await removeFilesFromKnowledgeBase(libraryId, [id]);

                    message.success(t('FileManager.actions.removeFromLibrarySuccess'));
                  },
                  title: t('FileManager.actions.confirmRemoveFromLibrary', {
                    count: 1,
                  }),
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

    return (
      [
        ...libraryRelatedActions,
        hasKnowledgeBaseActions && {
          type: 'divider',
        },
        isInLibrary && {
          icon: <Icon icon={FolderInputIcon} />,
          key: 'moveToFolder',
          label: t('FileManager.actions.moveToFolder'),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();

            createRawModal(MoveToFolderModal, {
              fileId: id,
              knowledgeBaseId: libraryId,
            });
          },
        },
        isFolder && {
          icon: <Icon icon={PencilIcon} />,
          key: 'rename',
          label: t('FileManager.actions.rename'),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();
            onRenameStart?.();
          },
        },
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
            message.success(t('FileManager.actions.copyUrlSuccess'));
          },
        },
        !isFolder && {
          icon: <Icon icon={DownloadIcon} />,
          key: 'download',
          label: t('download', { ns: 'common' }),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();
            const key = 'file-downloading';
            message.loading({
              content: t('FileManager.actions.downloading'),
              duration: 0,
              key,
            });

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
                  message.error('Failed to download page: no content available');
                }
              } catch (error) {
                console.error('Failed to download page:', error);
                message.error('Failed to download page');
              }
            } else {
              // For regular files, download from URL
              await downloadFile(url, filename);
            }

            message.destroy(key);
          },
        },
        {
          type: 'divider',
        },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();
            modal.confirm({
              content: isFolder
                ? t('FileManager.actions.confirmDeleteFolder')
                : t('FileManager.actions.confirmDelete'),
              okButtonProps: { danger: true },
              onOk: async () => {
                // Use optimistic delete - instant UI update, sync in background
                await deleteResource(id);

                // Ensure tree caches stay in sync with explorer
                if (libraryId) {
                  await clearTreeFolderCache(libraryId);
                }
                await refreshFileList();

                message.success(t('FileManager.actions.deleteSuccess'));
              },
            });
          },
        },
      ] as ItemType[]
    ).filter(Boolean);
  }, [
    addFilesToKnowledgeBase,
    clearTreeFolderCache,
    deleteResource,
    filename,
    id,
    isFolder,
    isInLibrary,
    isPage,
    libraries,
    libraryId,
    message,
    modal,
    moveResource,
    onRenameStart,
    refreshFileList,
    removeFilesFromKnowledgeBase,
    t,
    url,
  ]);

  return { menuItems };
};
