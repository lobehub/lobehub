import { Button, Flexbox, Icon, Modal } from '@lobehub/ui';
import { App } from 'antd';
import { FolderIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type FolderTreeItem } from '@/features/ResourceManager/components/FolderTree';
import FolderTree from '@/features/ResourceManager/components/FolderTree';
import { clearTreeFolderCache } from '@/features/ResourceManager/components/LibraryHierarchy';
import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';

interface MoveToFolderModalProps {
  fileId: string;
  knowledgeBaseId?: string;
  onClose: () => void;
  open: boolean;
}

const MoveToFolderModal = memo<MoveToFolderModalProps>(
  ({ open, onClose, fileId, knowledgeBaseId }) => {
    const { t } = useTranslation('components');
    const { message } = App.useApp();

    const [folders, setFolders] = useState<FolderTreeItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [loadedFolders, setLoadedFolders] = useState<Set<string>>(new Set());
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);

    const [moveResource, createFolder] = useFileStore((s) => [s.moveResource, s.createFolder]);

    // Sort items: folders only
    const sortItems = useCallback((items: FolderTreeItem[]): FolderTreeItem[] => {
      return [...items].sort((a, b) => a.name.localeCompare(b.name));
    }, []);

    // Fetch root level folders
    const fetchRootFolders = useCallback(async () => {
      setLoading(true);
      try {
        const response = await fileService.getKnowledgeItems({
          knowledgeBaseId,
          parentId: null,
          showFilesInKnowledgeBase: false,
        });

        // Filter only folders
        const folderItems = response.items
          .filter((item) => item.fileType === 'custom/folder')
          .map((item) => ({
            children: undefined,
            id: item.id,
            name: item.name,
            slug: item.slug,
          }));

        setFolders(sortItems(folderItems));
      } catch (error) {
        console.error('Failed to load folders:', error);
        setFolders([]);
      } finally {
        setLoading(false);
      }
    }, [knowledgeBaseId, sortItems]);

    useEffect(() => {
      if (open) {
        fetchRootFolders();
      }
    }, [open, fetchRootFolders]);

    const handleLoadFolder = useCallback(
      async (folderId: string) => {
        if (loadedFolders.has(folderId)) return;

        try {
          const response = await fileService.getKnowledgeItems({
            knowledgeBaseId,
            parentId: folderId,
            showFilesInKnowledgeBase: false,
          });

          // Filter only folders
          const childFolders: FolderTreeItem[] = response.items
            .filter((item) => item.fileType === 'custom/folder')
            .map((item) => ({
              children: undefined,
              id: item.id,
              name: item.name,
              slug: item.slug,
            }));

          const sortedChildren = sortItems(childFolders);

          setFolders((prevFolders) => {
            const updateFolder = (folders: FolderTreeItem[]): FolderTreeItem[] => {
              return folders.map((folder) => {
                const folderKey = folder.slug || folder.id;
                if (folderKey === folderId) {
                  return { ...folder, children: sortedChildren };
                }
                if (folder.children) {
                  return { ...folder, children: updateFolder(folder.children) };
                }
                return folder;
              });
            };
            return updateFolder(prevFolders);
          });

          setLoadedFolders((prev) => new Set([...prev, folderId]));
        } catch (error) {
          console.error('Failed to load folder contents:', error);
        }
      },
      [knowledgeBaseId, loadedFolders, sortItems],
    );

    // Reload folder children (bypass the loadedFolders guard)
    const reloadFolderChildren = useCallback(
      async (folderId: string) => {
        try {
          const response = await fileService.getKnowledgeItems({
            knowledgeBaseId,
            parentId: folderId,
            showFilesInKnowledgeBase: false,
          });

          // Filter only folders
          const childFolders: FolderTreeItem[] = response.items
            .filter((item) => item.fileType === 'custom/folder')
            .map((item) => ({
              children: undefined,
              id: item.id,
              name: item.name,
              slug: item.slug,
            }));

          const sortedChildren = sortItems(childFolders);

          setFolders((prevFolders) => {
            const updateFolder = (folders: FolderTreeItem[]): FolderTreeItem[] => {
              return folders.map((folder) => {
                const folderKey = folder.slug || folder.id;
                if (folderKey === folderId) {
                  return { ...folder, children: sortedChildren };
                }
                if (folder.children) {
                  return { ...folder, children: updateFolder(folder.children) };
                }
                return folder;
              });
            };
            return updateFolder(prevFolders);
          });
        } catch (error) {
          console.error('Failed to reload folder contents:', error);
        }
      },
      [knowledgeBaseId, sortItems],
    );

    const handleToggleFolder = useCallback((folderId: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
        }
        return next;
      });
    }, []);

    const handleFolderClick = useCallback((folderId: string, _folderSlug?: string | null) => {
      // Always use the document ID, not the slug
      setSelectedFolderId(folderId);
    }, []);

    const handleCreateNewFolder = useCallback(async () => {
      try {
        setIsCreatingFolder(true);

        // Create folder with default "Untitled" name
        const newFolderId = await createFolder(
          t('pageList.untitled', { ns: 'file' }),
          selectedFolderId ?? undefined, // Parent ID (root if none selected)
          knowledgeBaseId,
        );

        // Refresh tree to show the new folder
        if (selectedFolderId) {
          // Creating nested folder: auto-expand parent and reload its children
          setExpandedFolders((prev) => new Set([...prev, selectedFolderId]));
          await reloadFolderChildren(selectedFolderId);
        } else {
          // Creating at root: refetch root folders
          await fetchRootFolders();
        }

        // Auto-select the newly created folder
        setSelectedFolderId(newFolderId);
      } catch (error) {
        console.error('Failed to create folder:', error);
        message.error(t('FileManager.actions.renameError'));
      } finally {
        setIsCreatingFolder(false);
      }
    }, [
      selectedFolderId,
      knowledgeBaseId,
      createFolder,
      reloadFolderChildren,
      fetchRootFolders,
      t,
      message,
    ]);

    const handleMove = async () => {
      try {
        // Use optimistic moveResource for instant UI update
        await moveResource(fileId, selectedFolderId);

        // Clear and reload all expanded folders in Tree's module-level cache
        if (knowledgeBaseId) {
          await clearTreeFolderCache(knowledgeBaseId);
        }

        message.success(t('FileManager.actions.moveSuccess'));
        onClose();
      } catch (error) {
        console.error('Failed to move file:', error);
        message.error(t('FileManager.actions.moveError'));
      }
    };

    const handleMoveToRoot = async () => {
      try {
        // Use optimistic moveResource for instant UI update
        await moveResource(fileId, null);

        // Clear and reload all expanded folders in Tree's module-level cache
        if (knowledgeBaseId) {
          await clearTreeFolderCache(knowledgeBaseId);
        }

        message.success(t('FileManager.actions.moveSuccess'));
        onClose();
      } catch (error) {
        console.error('Failed to move file:', error);
        message.error(t('FileManager.actions.moveError'));
      }
    };

    return (
      <Modal
        open={open}
        title={t('FileManager.actions.moveToFolder')}
        footer={
          <Flexbox horizontal gap={8} justify={'flex-end'}>
            <Button onClick={onClose}>{t('cancel', { ns: 'common' })}</Button>
            <Button type="default" onClick={handleMoveToRoot}>
              {t('FileManager.actions.moveToRoot')}
            </Button>
            <Button disabled={!selectedFolderId} type="primary" onClick={handleMove}>
              {t('FileManager.actions.moveHere')}
            </Button>
          </Flexbox>
        }
        onCancel={onClose}
      >
        <Flexbox horizontal justify="flex-end" style={{ marginBottom: 12 }}>
          <Button
            icon={<Icon icon={FolderIcon} />}
            loading={isCreatingFolder}
            size="small"
            type="default"
            onClick={handleCreateNewFolder}
          >
            {t('header.actions.newFolder', { ns: 'file' })}
          </Button>
        </Flexbox>
        <Flexbox style={{ maxHeight: 400, minHeight: 200, overflowY: 'auto' }}>
          {loading ? (
            <div>{t('loading', { ns: 'common' })}</div>
          ) : folders.length === 0 ? (
            <Flexbox align="center" justify="center" style={{ minHeight: 200 }}>
              <div style={{ color: 'var(--lobe-color-text-secondary)' }}>
                {t('FileManager.noFolders')}
              </div>
            </Flexbox>
          ) : (
            <FolderTree
              expandedFolders={expandedFolders}
              items={folders}
              loadedFolders={loadedFolders}
              selectedKey={selectedFolderId}
              onFolderClick={handleFolderClick}
              onLoadFolder={handleLoadFolder}
              onToggleFolder={handleToggleFolder}
            />
          )}
        </Flexbox>
      </Modal>
    );
  },
);

MoveToFolderModal.displayName = 'MoveToFolderModal';

export default MoveToFolderModal;
