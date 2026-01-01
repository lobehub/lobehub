'use client';

import { FILE_URL } from '@lobechat/business-const';
import { Notion } from '@lobehub/icons';
import { Button, Dropdown, Icon, type MenuProps } from '@lobehub/ui';
import { Upload } from 'antd';
import { FilePenLine, FileUp, FolderIcon, FolderUp, Link, Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import DragUpload from '@/components/DragUpload';
import GuideModal from '@/components/GuideModal';
import GuideVideo from '@/components/GuideVideo';
import { useFileStore } from '@/store/file';
import { DocumentSourceType } from '@/types/document';

import useNotionImport from './hooks/useNotionImport';
import useUploadFolder from './hooks/useUploadFolder';

const AddButton = () => {
  const { t } = useTranslation('file');
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const uploadFolderWithStructure = useFileStore((s) => s.uploadFolderWithStructure);
  const createFolder = useFileStore((s) => s.createFolder);
  const createDocument = useFileStore((s) => s.createDocument);
  const refreshFileList = useFileStore((s) => s.refreshFileList);

  const [libraryId, currentFolderId, setCurrentViewItemId, setMode, setPendingRenameItemId] =
    useResourceManagerStore((s) => [
      s.libraryId,
      s.currentFolderId,
      s.setCurrentViewItemId,
      s.setMode,
      s.setPendingRenameItemId,
    ]);

  const handleOpenPageEditor = useCallback(async () => {
    // Create a new page directly and switch to page view
    const untitledTitle = t('pageList.untitled');
    const newPage = await createDocument({
      content: '',
      knowledgeBaseId: libraryId,
      parentId: currentFolderId ?? undefined,
      title: untitledTitle,
    });

    // Add to local document map for immediate availability
    const newDocumentMap = new Map(useFileStore.getState().localDocumentMap);
    newDocumentMap.set(newPage.id, {
      content: newPage.content || '',
      createdAt: newPage.createdAt ? new Date(newPage.createdAt) : new Date(),
      editorData:
        typeof newPage.editorData === 'string'
          ? JSON.parse(newPage.editorData)
          : newPage.editorData || null,
      fileType: 'custom/document',
      filename: newPage.title || untitledTitle,
      id: newPage.id,
      metadata: newPage.metadata || {},
      source: 'document',
      sourceType: DocumentSourceType.EDITOR,
      title: newPage.title || untitledTitle,
      totalCharCount: newPage.content?.length || 0,
      totalLineCount: 0,
      updatedAt: newPage.updatedAt ? new Date(newPage.updatedAt) : new Date(),
    });
    useFileStore.setState({ localDocumentMap: newDocumentMap });

    // Switch to page view mode
    setCurrentViewItemId(newPage.id);
    setMode('page');
  }, [createDocument, currentFolderId, libraryId, setCurrentViewItemId, setMode, t]);

  const handleCreateFolder = useCallback(async () => {
    const folderId = await createFolder('Untitled', currentFolderId ?? undefined, libraryId);
    // Trigger auto-rename
    setPendingRenameItemId(folderId);
  }, [createFolder, currentFolderId, libraryId, setPendingRenameItemId]);

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
    refreshFileList,
    t,
  });

  const { handleFolderUpload } = useUploadFolder({
    currentFolderId,
    libraryId,
    t,
    uploadFolderWithStructure,
  });

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
        icon: <Icon icon={FileUp} />,
        key: 'upload-file',
        label: (
          <Upload
            beforeUpload={async (file) => {
              await pushDockFileList([file], libraryId, currentFolderId ?? undefined);

              return false;
            }}
            multiple={true}
            showUploadList={false}
          >
            <div>{t('header.actions.uploadFile')}</div>
          </Upload>
        ),
      },
      {
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
          // {
          //   icon: <Icon icon={Notion} />,
          //   key: 'connect-google-drive',
          //   label: 'Google Drive',
          //   onClick: () => {
          //     // TODO: Implement Google Drive connection
          //   },
          // },
          // {
          //   icon: <Icon icon={Notion} />,
          //   key: 'connect-onedrive',
          //   label: 'OneDrive',
          //   onClick: () => {
          //     // TODO: Implement OneDrive connection
          //   },
          // },
        ],
        icon: <Icon icon={Link} />,
        key: 'connect',
        label: t('header.actions.connect'),
      },
    ],
    [
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
      <Dropdown menu={{ items }} placement="bottomRight" trigger={['hover']}>
        <Button
          icon={Plus}
          onClick={(e) => {
            // Prevent default button behavior that might interfere with dropdown
            e.stopPropagation();
          }}
          type="primary"
        >
          {t('addLibrary')}
        </Button>
      </Dropdown>
      <GuideModal
        cancelText={t('header.actions.notionGuide.cancel')}
        cover={<GuideVideo height={269} src={FILE_URL.importFromNotionGuide} width={358} />}
        desc={t('header.actions.notionGuide.desc')}
        okText={t('header.actions.notionGuide.ok')}
        onCancel={handleCloseNotionGuide}
        onOk={handleStartNotionImport}
        open={notionGuideOpen}
        title={t('header.actions.notionGuide.title')}
      />
      <DragUpload
        enabledFiles
        onUploadFiles={(files) => pushDockFileList(files, libraryId, currentFolderId ?? undefined)}
      />
      <input
        id="folder-upload-input"
        multiple
        onChange={handleFolderUpload}
        style={{ display: 'none' }}
        type="file"
        // @ts-expect-error - webkitdirectory is not in the React types
        webkitdirectory=""
      />
      <input
        accept=".zip"
        onChange={handleNotionImport}
        ref={notionInputRef}
        style={{ display: 'none' }}
        type="file"
      />
    </>
  );
};

export default AddButton;
