import { Icon, copyToClipboard, createRawModal } from '@lobehub/ui';
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
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import RepoIcon from '@/components/LibIcon';
import { documentService } from '@/services/document';
import { useFileStore } from '@/store/file';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';
import { downloadFile } from '@/utils/client/downloadFile';

import MoveToFolderModal from '../MoveToFolderModal';

interface UseFileItemDropdownParams {
  enabled?: boolean;
  fileType: string;
  filename: string;
  id: string;
  knowledgeBaseId?: string;
  onRenameStart?: () => void;
  sourceType?: string;
  url: string;
}

interface UseFileItemDropdownReturn {
  menuItems: ItemType[];
}

export const useFileItemDropdown = ({
  enabled = true,
  id,
  knowledgeBaseId,
  url,
  filename,
  fileType,
  sourceType,
  onRenameStart,
}: UseFileItemDropdownParams): UseFileItemDropdownReturn => {
  const { t } = useTranslation(['components', 'common', 'knowledgeBase']);
  const { message, modal } = App.useApp();

  const [removeFile, refreshFileList] = useFileStore((s) => [s.removeFileItem, s.refreshFileList]);
  const [removeFilesFromKnowledgeBase, addFilesToKnowledgeBase, useFetchKnowledgeBaseList] =
    useKnowledgeBaseStore((s) => [
      s.removeFilesFromKnowledgeBase,
      s.addFilesToKnowledgeBase,
      s.useFetchKnowledgeBaseList,
    ]);

  // Only fetch knowledge bases when dropdown is enabled (open)
  // This prevents the expensive SWR call for all 20-25 visible items
  const { data: knowledgeBases } = useFetchKnowledgeBaseList();

  const inKnowledgeBase = !!knowledgeBaseId;
  const isFolder = fileType === 'custom/folder';
  const isPage = sourceType === 'document' || fileType === 'custom/document';

  const menuItems = useMemo(() => {
    // Skip building menu items when dropdown is not open (performance optimization)
    if (!enabled) return [];

    // Filter out current knowledge base and create submenu items
    const availableKnowledgeBases = (knowledgeBases || []).filter(
      (kb) => kb.id !== knowledgeBaseId,
    );

    const addToKnowledgeBaseSubmenu: ItemType[] = availableKnowledgeBases.map((kb) => ({
      icon: <RepoIcon />,
      key: `add-to-kb-${kb.id}`,
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
        } catch (e) {
          console.error(e);
          message.error(t('addToKnowledgeBase.error', { ns: 'knowledgeBase' }));
        }
      },
    }));

    const knowledgeBaseActions = (
      inKnowledgeBase
        ? [
            availableKnowledgeBases.length > 0 && {
              children: addToKnowledgeBaseSubmenu,
              icon: <Icon icon={BookPlusIcon} />,
              key: 'addToOtherKnowledgeBase',
              label: t('FileManager.actions.addToOtherKnowledgeBase'),
            },
            {
              icon: <Icon icon={BookMinusIcon} />,
              key: 'removeFromKnowledgeBase',
              label: t('FileManager.actions.removeFromKnowledgeBase'),
              onClick: async ({ domEvent }) => {
                domEvent.stopPropagation();

                modal.confirm({
                  okButtonProps: {
                    danger: true,
                  },
                  onOk: async () => {
                    await removeFilesFromKnowledgeBase(knowledgeBaseId, [id]);

                    message.success(t('FileManager.actions.removeFromKnowledgeBaseSuccess'));
                  },
                  title: t('FileManager.actions.confirmRemoveFromKnowledgeBase', {
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
              key: 'addToKnowledgeBase',
              label: t('FileManager.actions.addToKnowledgeBase'),
            },
          ]
    ) as ItemType[];

    const hasKnowledgeBaseActions = knowledgeBaseActions.some(Boolean);

    return (
      [
        ...knowledgeBaseActions,
        hasKnowledgeBaseActions && {
          type: 'divider',
        },
        inKnowledgeBase && {
          icon: <Icon icon={FolderInputIcon} />,
          key: 'moveToFolder',
          label: t('FileManager.actions.moveToFolder'),
          onClick: async ({ domEvent }) => {
            domEvent.stopPropagation();

            createRawModal(MoveToFolderModal, {
              fileId: id,
              knowledgeBaseId,
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
              const baseUrl = window.location.origin;
              if (knowledgeBaseId) {
                urlToCopy = `${baseUrl}/resource/library/${knowledgeBaseId}?file=${id}`;
              } else {
                urlToCopy = `${baseUrl}/resource?file=${id}`;
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
                if (isFolder || isPage) {
                  await documentService.deleteDocument(id);
                  await refreshFileList();
                } else {
                  await removeFile(id);
                }
              },
            });
          },
        },
      ] as ItemType[]
    ).filter(Boolean);
  }, [enabled, inKnowledgeBase, isFolder, knowledgeBases, knowledgeBaseId, id]);

  return { menuItems };
};
