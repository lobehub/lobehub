'use client';

import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { Notion } from '@lobehub/icons';
import { type DropdownItem } from '@lobehub/ui';
import { DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Upload } from 'antd';
import { FilePenLine, FileUp, FolderIcon, FolderUp, Link, Plus } from 'lucide-react';
import { type ChangeEvent } from 'react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentFolderId } from '@/features/ResourceManager/hooks/useCurrentFolderId';
import { useTopLevelFileUpload } from '@/features/ResourceManager/hooks/useTopLevelFileUpload';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';
import { useTreeStore } from '@/store/tree';
import { FilesTabs } from '@/types/files';

import useNotionImport from './hooks/useNotionImport';
import useUploadFolder from './hooks/useUploadFolder';

const getAcceptedFileTypes = (category: FilesTabs): string | undefined => {
  switch (category) {
    case FilesTabs.Videos: {
      return 'video/*';
    }
    case FilesTabs.Audios: {
      return 'audio/*';
    }
    case FilesTabs.Documents: {
      return '.pdf,.doc,.docx,.md,.markdown,.txt,.rtf,.csv,.xls,.xlsx,.ppt,.pptx,.epub';
    }
    case FilesTabs.Images: {
      return 'image/*';
    }
    default: {
      return undefined;
    }
  }
};

interface AddButtonProps {
  /**
   * Render a square icon-only trigger (sidebar toolbar) instead of the
   * labelled primary button used in the Explorer header.
   */
  iconOnly?: boolean;
  /**
   * Create and upload at the library's top level instead of the folder the
   * URL is currently in. The sidebar toolbar sits beside the library name, so
   * its entries read as library-level; creating inside a specific folder is
   * what that folder row's own "+" (`FolderAddButton`) is for.
   */
  rootLevel?: boolean;
}

const AddButton = ({ iconOnly, rootLevel }: AddButtonProps = {}) => {
  const { t } = useTranslation('file');
  // Several instances can be mounted at once (Explorer header, sidebar toolbar,
  // empty state); a fixed id would make every "Upload folder" label open the
  // first instance's input.
  const folderUploadInputId = useId();
  const uploadFolderWithStructure = useFileStore((s) => s.uploadFolderWithStructure);
  const createResourceAndSync = useFileStore((s) => s.createResourceAndSync);
  const [menuOpen, setMenuOpen] = useState(false);
  const urlFolderId = useCurrentFolderId();
  const currentFolderId = rootLevel ? null : urlFolderId;
  const { allowed: canCreate, reason } = usePermission('create_content');
  const uploadTopLevel = useTopLevelFileUpload({ rootLevel });

  // TODO: Migrate Notion import to use createResource
  // Keep old functions temporarily for components not yet migrated
  const createDocument = useFileStore((s) => s.createDocument);

  const [
    libraryId,
    category,
    setCategory,
    setCurrentViewItemId,
    setMode,
    setPendingRenameItemId,
    setPendingTreeRenameItemId,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.setCategory,
    s.setCurrentViewItemId,
    s.setMode,
    s.setPendingRenameItemId,
    s.setPendingTreeRenameItemId,
  ]);

  // The sidebar tree only mirrors the folder the Explorer is showing, so a
  // root-level create made while a folder is open has to refresh the root
  // itself for the new row to appear.
  const revealRoot = useCallback(() => {
    if (!rootLevel) return;
    void useTreeStore.getState().revalidate('');
  }, [rootLevel]);

  const handleOpenPageEditor = useCallback(async () => {
    // Navigate to "All" category first if not already there. The home
    // dashboard and the Pages category both surface the new page, so stay put.
    if (category !== FilesTabs.All && category !== FilesTabs.Home && category !== FilesTabs.Pages) {
      setCategory(FilesTabs.All);
    }

    // Create a new page and wait for server sync - ensures page editor can load the document
    const untitledTitle = t('pageList.untitled');
    const realId = await createResourceAndSync({
      content: '',
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      knowledgeBaseId: libraryId,
      parentId: currentFolderId ?? undefined,
      sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
      title: untitledTitle,
    });
    revealRoot();

    // Switch to page view mode with real ID
    setCurrentViewItemId(realId);
    setMode('page');
  }, [
    category,
    createResourceAndSync,
    currentFolderId,
    libraryId,
    revealRoot,
    setCategory,
    setCurrentViewItemId,
    setMode,
    t,
  ]);

  const handleCreateFolder = useCallback(async () => {
    // Navigate to "All" category first if not already there
    if (category !== FilesTabs.All && category !== FilesTabs.Home) {
      setCategory(FilesTabs.All);
    }

    // Create folder and wait for sync to complete before triggering rename
    try {
      // Unique "Untitled N" among the sibling folders. At the root the tree's
      // own root cache is the reliable sibling list — the Explorer may be
      // showing a different folder entirely.
      const siblingFolderNames = rootLevel
        ? (useTreeStore.getState().children[''] ?? [])
            .filter((item) => item.isFolder)
            .map((item) => item.name)
        : (useFileStore.getState().resourceList || [])
            .filter(
              (item) =>
                item.fileType === CUSTOM_FOLDER_FILE_TYPE &&
                (item.parentId ?? null) === (currentFolderId ?? null),
            )
            .map((folder) => folder.name);

      // Generate unique folder name
      const baseName = t('pageList.untitled');
      const existingNames = new Set(siblingFolderNames);

      let uniqueName = baseName;
      let counter = 1;

      while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName} ${counter}`;
        counter++;
      }

      // Wait for sync to complete to get the real ID
      const realId = await createResourceAndSync({
        content: '',
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        knowledgeBaseId: libraryId,
        parentId: currentFolderId ?? undefined,
        sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
        title: uniqueName,
      });

      // Trigger auto-rename with the real ID (after sync completes). The
      // sidebar's create renames inline in the tree row, where the user
      // clicked; the Explorer's create renames in its own list.
      if (rootLevel) {
        revealRoot();
        setPendingTreeRenameItemId(realId);
      } else {
        setPendingRenameItemId(realId);
      }
    } catch (error) {
      toast.error(t('header.actions.createFolderError'));
      console.error('Failed to create folder:', error);
    }
  }, [
    category,
    createResourceAndSync,
    currentFolderId,
    libraryId,
    revealRoot,
    rootLevel,
    setCategory,
    setPendingRenameItemId,
    setPendingTreeRenameItemId,
    t,
  ]);

  const { handleNotionImport, handleOpenNotionGuide, notionInputRef } = useNotionImport({
    createDocument,
    currentFolderId,
    libraryId,
    refetchResources: rootLevel ? async () => revealRoot() : undefined,
    t,
  });

  const { handleFolderUpload } = useUploadFolder({
    currentFolderId,
    libraryId,
    onUploaded: revealRoot,
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

  const items = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <Icon icon={FilePenLine} />,
        key: 'create-note',
        label: t('header.actions.newPage'),
        onClick: handleOpenPageEditor,
      },
      ...(libraryId
        ? [
            {
              icon: <Icon icon={FolderIcon} />,
              key: 'create-folder',
              label: t('header.actions.newFolder'),
              onClick: handleCreateFolder,
            },
          ]
        : []),
      {
        type: 'divider',
      },
      {
        closeOnClick: false,
        icon: <Icon icon={FileUp} />,
        key: 'upload-file',
        label: (
          <Upload
            accept={getAcceptedFileTypes(category)}
            multiple={true}
            showUploadList={false}
            beforeUpload={async (file) => {
              setMenuOpen(false);
              await uploadTopLevel([file]);
              revealRoot();
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
      category,
      folderUploadInputId,
      handleCreateFolder,
      handleOpenPageEditor,
      handleOpenNotionGuide,
      libraryId,
      revealRoot,
      uploadTopLevel,
      t,
    ],
  );

  return (
    <>
      <Tooltip title={canCreate ? undefined : reason}>
        <DropdownMenu
          items={canCreate ? items : []}
          open={menuOpen}
          placement="bottomRight"
          onOpenChange={(open) => {
            if (!canCreate) return;
            setMenuOpen(open);
          }}
        >
          {iconOnly ? (
            <Button
              data-no-highlight
              aria-label={t('addLibrary')}
              disabled={!canCreate}
              icon={Plus}
              title={canCreate ? t('addLibrary') : undefined}
            />
          ) : (
            <Button data-no-highlight disabled={!canCreate} icon={Plus} type="primary">
              {t('addLibrary')}
            </Button>
          )}
        </DropdownMenu>
      </Tooltip>
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
  );
};

export default AddButton;
