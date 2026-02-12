'use client';

import { FILE_URL } from '@lobechat/business-const';
import { Notion } from '@lobehub/icons';
import { type MenuProps } from '@lobehub/ui';
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { Upload } from 'antd';
import { FilePenLine, FileUp, FolderIcon, FolderUp, Link, Plus } from 'lucide-react';
import { type ChangeEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { message } from '@/components/AntdStaticMethods';
import GuideModal from '@/components/GuideModal';
import GuideVideo from '@/components/GuideVideo';
import { useFileStore } from '@/store/file';
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
      return '.pdf,.doc,.docx,.md,.markdown,.xls,.xlsx';
    }
    case FilesTabs.Images: {
      return 'image/*';
    }
    default: {
      return undefined;
    }
  }
};

const AddButton = () => {
  const { t } = useTranslation('file');
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const uploadFolderWithStructure = useFileStore((s) => s.uploadFolderWithStructure);
  const createResourceAndSync = useFileStore((s) => s.createResourceAndSync);
  const [menuOpen, setMenuOpen] = useState(false);

  // TODO: Migrate Notion import to use createResource
  // Keep old functions temporarily for components not yet migrated
  const createDocument = useFileStore((s) => s.createDocument);

  const [
    libraryId,
    category,
    currentFolderId,
    setCategory,
    setCurrentViewItemId,
    setMode,
    setPendingRenameItemId,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.currentFolderId,
    s.setCategory,
    s.setCurrentViewItemId,
    s.setMode,
    s.setPendingRenameItemId,
  ]);

  const handleOpenPageEditor = useCallback(async () => {
    // Navigate to "All" category first if not already there
    if (category !== FilesTabs.All) {
      setCategory(FilesTabs.All);
    }

    // Create a new page and wait for server sync - ensures page editor can load the document
    const untitledTitle = t('pageList.untitled');
    const realId = await createResourceAndSync({
      content: '',
      fileType: 'custom/document',
      knowledgeBaseId: libraryId,
      parentId: currentFolderId ?? undefined,
      sourceType: 'document',
      title: untitledTitle,
    });

    // Switch to page view mode with real ID
    setCurrentViewItemId(realId);
    setMode('page');
  }, [
    category,
    createResourceAndSync,
    currentFolderId,
    libraryId,
    setCategory,
    setCurrentViewItemId,
    setMode,
    t,
  ]);

  const handleCreateFolder = useCallback(async () => {
    // Navigate to "All" category first if not already there
    if (category !== FilesTabs.All) {
      setCategory(FilesTabs.All);
    }

    // Create folder and wait for sync to complete before triggering rename
    try {
      // Get current resource list to check for duplicate folder names
      const resourceList = useFileStore.getState().resourceList || [];

      // Filter for folders at the same level
      const foldersAtSameLevel = resourceList.filter(
        (item) =>
          item.fileType === 'custom/folder' &&
          (item.parentId ?? null) === (currentFolderId ?? null),
      );

      // Generate unique folder name
      const baseName = 'Untitled';
      const existingNames = new Set(foldersAtSameLevel.map((folder) => folder.name));

      let uniqueName = baseName;
      let counter = 1;

      while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName} ${counter}`;
        counter++;
      }

      // Wait for sync to complete to get the real ID
      const realId = await createResourceAndSync({
        content: '',
        fileType: 'custom/folder',
        knowledgeBaseId: libraryId,
        parentId: currentFolderId ?? undefined,
        sourceType: 'document',
        title: uniqueName,
      });

      // Trigger auto-rename with the real ID (after sync completes)
      setPendingRenameItemId(realId);
    } catch (error) {
      message.error(t('header.actions.createFolderError'));
      console.error('Failed to create folder:', error);
    }
  }, [
    category,
    createResourceAndSync,
    currentFolderId,
    libraryId,
    setCategory,
    setPendingRenameItemId,
    t,
  ]);

  const {
    handleCloseNotionGuide,
    handleNotionImport,
    handleOpenNotionGuide,
    handleStartNotionImport,
    notionGuideOpen,
    notionInputRef,
  } = useNotionImport({
    createDocument,
    currentFolderId,
    libraryId,
    refetchResources: async () => {
      const { revalidateResources } = await import('@/store/file/slices/resource/hooks');
      await revalidateResources();
    },
    t,
  });

  const { handleFolderUpload } = useUploadFolder({
    currentFolderId,
    libraryId,
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

  const items = useMemo<MenuProps['items']>(
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
              await pushDockFileList([file], libraryId, currentFolderId ?? undefined);

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
        label: <label htmlFor="folder-upload-input">{t('header.actions.uploadFolder')}</label>,
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
      },
    ],
    [
      category,
      currentFolderId,
      handleCreateFolder,
      handleOpenPageEditor,
      handleOpenNotionGuide,
      libraryId,
      pushDockFileList,
      t,
    ],
  );

  return (
    <>
      <DropdownMenu
        items={items}
        open={menuOpen}
        placement="bottomRight"
        trigger="both"
        onOpenChange={setMenuOpen}
      >
        <Button data-no-highlight icon={Plus} type="primary">
          {t('addLibrary')}
        </Button>
      </DropdownMenu>
      <GuideModal
        cancelText={t('header.actions.notionGuide.cancel')}
        cover={<GuideVideo height={269} src={FILE_URL.importFromNotionGuide} width={358} />}
        desc={t('header.actions.notionGuide.desc')}
        okText={t('header.actions.notionGuide.ok')}
        open={notionGuideOpen}
        title={t('header.actions.notionGuide.title')}
        onCancel={handleCloseNotionGuide}
        onOk={handleStartNotionImport}
      />
      <input
        multiple
        id="folder-upload-input"
        style={{ display: 'none' }}
        onChange={handleFolderUploadWithClose}
        type="file"
        // @ts-expect-error - webkitdirectory is not in the React types
        webkitdirectory=""
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
