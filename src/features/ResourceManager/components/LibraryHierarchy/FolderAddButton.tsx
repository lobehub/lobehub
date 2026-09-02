'use client';

import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { Notion } from '@lobehub/icons';
import { type DropdownItem, DropdownMenu, Icon, stopPropagation } from '@lobehub/ui';
import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { Upload } from 'antd';
import { FilePenLine, FileUp, FolderIcon, FolderUp, Link, Plus } from 'lucide-react';
import { type ChangeEvent } from 'react';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import useNotionImport from '@/features/ResourceManager/components/Header/hooks/useNotionImport';
import useUploadFolder from '@/features/ResourceManager/components/Header/hooks/useUploadFolder';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';
import { useTreeStore } from '@/store/tree';

interface FolderAddButtonProps {
  folderId: string;
}

/**
 * Per-folder create entry on a tree row: everything it creates lands INSIDE
 * this folder, unlike the sidebar-level AddButton which targets the folder the
 * URL is currently in. Revealed on row hover (see styles.ts
 * `.hierarchy-node-actions`).
 */
const FolderAddButton = memo<FolderAddButtonProps>(({ folderId }) => {
  const { t } = useTranslation('file');
  const [menuOpen, setMenuOpen] = useState(false);
  // Sticky: the hidden upload/Notion inputs mount on first open and then stay,
  // because the file picker's onChange (and the Notion guide modal's OK) fire
  // AFTER the menu has closed — unmounting them with the menu would drop the
  // callback. Keeping them off until first open avoids two hidden inputs per
  // folder row on large trees.
  const [hasOpened, setHasOpened] = useState(false);
  // Several rows mount at once; a fixed id would point every folder-upload
  // label at the first row's input.
  const folderUploadInputId = useId();
  const { allowed: canCreate } = usePermission('create_content');
  const createResourceAndSync = useFileStore((s) => s.createResourceAndSync);
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const uploadFolderWithStructure = useFileStore((s) => s.uploadFolderWithStructure);
  const createDocument = useFileStore((s) => s.createDocument);
  const [libraryId, setCurrentViewItemId, setMode, setPendingTreeRenameItemId] =
    useResourceManagerStore((s) => [
      s.libraryId,
      s.setCurrentViewItemId,
      s.setMode,
      s.setPendingTreeRenameItemId,
    ]);

  // The created row only becomes visible once this folder is open and its
  // children include it: expand a collapsed folder (which loads its children
  // when uncached) and always revalidate so a cached list picks the new row up.
  const revealChildren = useCallback(() => {
    const tree = useTreeStore.getState();
    if (!tree.expanded[folderId]) tree.toggle(folderId);
    void tree.revalidate(folderId);
  }, [folderId]);

  const handleCreatePage = useCallback(async () => {
    const realId = await createResourceAndSync({
      content: '',
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      knowledgeBaseId: libraryId,
      parentId: folderId,
      sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
      title: t('pageList.untitled'),
    });
    revealChildren();
    setCurrentViewItemId(realId);
    setMode('page');
  }, [
    createResourceAndSync,
    folderId,
    libraryId,
    revealChildren,
    setCurrentViewItemId,
    setMode,
    t,
  ]);

  const handleCreateFolder = useCallback(async () => {
    try {
      // Unique "Untitled N" among the siblings already loaded for this folder.
      const siblings = useTreeStore.getState().children[folderId] ?? [];
      const existingNames = new Set(siblings.filter((i) => i.isFolder).map((i) => i.name));
      const baseName = t('pageList.untitled');
      let uniqueName = baseName;
      let counter = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName} ${counter}`;
        counter++;
      }

      const realId = await createResourceAndSync({
        content: '',
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        knowledgeBaseId: libraryId,
        parentId: folderId,
        sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
        title: uniqueName,
      });
      revealChildren();
      // The tree node consumes this and enters inline rename once it mounts.
      setPendingTreeRenameItemId(realId);
    } catch (error) {
      toast.error(t('header.actions.createFolderError'));
      console.error('Failed to create folder:', error);
    }
  }, [createResourceAndSync, folderId, libraryId, revealChildren, setPendingTreeRenameItemId, t]);

  // Reveal from the upload completion callback rather than after awaiting
  // `handleFolderUpload`: with a `.gitignore` in the selection the upload is
  // deferred behind a confirm dialog and the promise resolves before anything
  // has been created.
  const { handleFolderUpload } = useUploadFolder({
    currentFolderId: folderId,
    libraryId,
    onUploaded: revealChildren,
    t,
    uploadFolderWithStructure,
  });
  const handleFolderUploadWithClose = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setMenuOpen(false);
      return handleFolderUpload(event);
    },
    [handleFolderUpload],
  );

  const { handleNotionImport, handleOpenNotionGuide, notionInputRef } = useNotionImport({
    createDocument,
    currentFolderId: folderId,
    libraryId,
    refetchResources: async () => revealChildren(),
    t,
  });

  const items = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <Icon icon={FilePenLine} />,
        key: 'create-note',
        label: t('header.actions.newPage'),
        onClick: handleCreatePage,
      },
      {
        icon: <Icon icon={FolderIcon} />,
        key: 'create-folder',
        label: t('header.actions.newFolder'),
        onClick: handleCreateFolder,
      },
      {
        type: 'divider',
      },
      {
        closeOnClick: false,
        icon: <Icon icon={FileUp} />,
        key: 'upload-file',
        label: (
          <Upload
            multiple
            showUploadList={false}
            beforeUpload={async (file) => {
              setMenuOpen(false);
              await pushDockFileList([file], libraryId, folderId);
              revealChildren();
              return false;
            }}
          >
            <div>{t('header.actions.uploadFile')}</div>
          </Upload>
        ),
      },
      {
        closeOnClick: false,
        icon: <Icon icon={FolderUp} />,
        key: 'upload-folder',
        label: <label htmlFor={folderUploadInputId}>{t('header.actions.uploadFolder')}</label>,
      },
      {
        type: 'divider',
      },
      {
        children: [
          {
            icon: <Notion />,
            key: 'connect-notion',
            label: 'Notion',
            onClick: handleOpenNotionGuide,
          },
        ],
        icon: <Icon icon={Link} />,
        key: 'connect',
        label: t('header.actions.connect'),
        type: 'submenu',
      },
    ],
    [
      folderId,
      folderUploadInputId,
      handleCreateFolder,
      handleCreatePage,
      handleOpenNotionGuide,
      libraryId,
      pushDockFileList,
      revealChildren,
      t,
    ],
  );

  if (!canCreate) return null;

  return (
    <div
      className={'hierarchy-node-actions'}
      data-open={menuOpen}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <DropdownMenu
        items={items}
        open={menuOpen}
        placement="bottomLeft"
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) setHasOpened(true);
        }}
      >
        <ActionIcon icon={Plus} size={'small'} title={t('addLibrary')} />
      </DropdownMenu>
      {hasOpened && (
        <>
          <input
            multiple
            id={folderUploadInputId}
            style={{ display: 'none' }}
            type="file"
            // @ts-expect-error - webkitdirectory is not in the React types
            webkitdirectory=""
            onChange={handleFolderUploadWithClose}
          />
          <input
            accept=".zip"
            ref={notionInputRef}
            style={{ display: 'none' }}
            type="file"
            onChange={handleNotionImport}
          />
        </>
      )}
    </div>
  );
});

FolderAddButton.displayName = 'FolderAddButton';

export default FolderAddButton;
