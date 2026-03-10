import { FILE_URL } from '@lobechat/business-const';
import { Notion } from '@lobehub/icons';
import { Center, FileTypeIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Upload } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GuideModal from '@/components/GuideModal';
import GuideVideo from '@/components/GuideVideo';
import NavHeader from '@/features/NavHeader';
import useNotionImport from '@/features/ResourceManager/components/Header/hooks/useNotionImport';
import { useFileStore } from '@/store/file';
import { usePageStore } from '@/store/page';
import { DocumentSourceType } from '@/types/document';
import { standardizeIdentifier } from '@/utils/identifier';

const ICON_SIZE = 80;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionTitle: css`
    margin-block-start: 12px;
    font-size: 16px;
    color: ${cssVar.colorTextSecondary};
  `,
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 200px;
    height: 140px;
    border-radius: ${cssVar.borderRadiusLG};

    font-weight: 500;
    text-align: center;

    background: ${cssVar.colorFillTertiary};
    box-shadow: 0 0 0 1px ${cssVar.colorFillTertiary} inset;

    transition: background 0.3s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  glow: css`
    position: absolute;
    inset-block-end: -12px;
    inset-inline-end: 0;

    width: 48px;
    height: 48px;

    opacity: 0.5;
    filter: blur(24px);
  `,
  icon: css`
    position: absolute;
    z-index: 1;
    inset-block-end: -24px;
    inset-inline-end: 8px;

    flex: none;
  `,
}));

interface PageExplorerPlaceholderProps {
  hasPages?: boolean;
  knowledgeBaseId?: string;
}

const PageExplorerPlaceholder = memo<PageExplorerPlaceholderProps>(
  ({ hasPages = false, knowledgeBaseId }) => {
    const { t } = useTranslation(['file', 'common']);
    const [isUploading, setIsUploading] = useState(false);

    // Page-specific operations from pageStore
    const [
      createNewPage,
      createOptimisticPage,
      replaceTempPageWithReal,
      setSelectedPageId,
      fetchDocuments,
    ] = usePageStore((s) => [
      s.createNewPage,
      s.createOptimisticPage,
      s.replaceTempPageWithReal,
      s.setSelectedPageId,
      s.fetchDocuments,
    ]);

    // File operations from FileStore (for uploads and notion import)
    const [createDocument] = useFileStore((s) => [s.createDocument]);

    const notionImport = useNotionImport({
      createDocument,
      currentFolderId: null,
      libraryId: knowledgeBaseId ?? null,
      refetchResources: async () => {
        const { revalidateResources } = await import('@/store/file/slices/resource/hooks');
        await revalidateResources();
        await fetchDocuments();
      },
      t,
    });

    // Wrap handleNotionImport to ensure UI updates
    const handleNotionImportWithLocalUpdate = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      await notionImport.handleNotionImport(event);
      // Fetch documents to update the UI immediately
      // The hook calls refreshFileList which invalidates SWR cache,
      // but we need to explicitly fetch to update the zustand store
      await fetchDocuments();
    };

    const handleCreateDocument = async (content: string, title: string) => {
      if (!content) {
        // For empty pages, use createNewPage which handles optimistic updates
        await createNewPage(title);
        return;
      }

      // For markdown uploads with content, use optimistic pattern similar to createNewPage
      const tempPageId = createOptimisticPage(title);
      // Set selected page to temp ID immediately (with URL update disabled for temp IDs)
      setSelectedPageId(tempPageId, false);

      try {
        const newDoc = await createDocument({
          content,
          knowledgeBaseId,
          title,
        });

        // Convert to LobeDocument format
        const realPage = {
          content: newDoc.content || '',
          createdAt: newDoc.createdAt ? new Date(newDoc.createdAt) : new Date(),
          editorData:
            typeof newDoc.editorData === 'string'
              ? JSON.parse(newDoc.editorData)
              : newDoc.editorData || null,
          fileType: 'custom/document' as const,
          filename: newDoc.title || title,
          id: newDoc.id,
          metadata: newDoc.metadata || {},
          source: 'document' as const,
          sourceType: DocumentSourceType.EDITOR,
          title: newDoc.title || title,
          totalCharCount: newDoc.content?.length || 0,
          totalLineCount: 0,
          updatedAt: newDoc.updatedAt ? new Date(newDoc.updatedAt) : new Date(),
        };

        // Replace optimistic with real
        replaceTempPageWithReal(tempPageId, realPage);
        // Update selected page ID and URL to the real page
        setSelectedPageId(newDoc.id);
      } catch (error) {
        console.error('Failed to create page:', error);
        // Remove temp document on error
        usePageStore.getState().removeTempPage(tempPageId);
        setSelectedPageId(null);
        throw error;
      }
    };

    const handleUploadFile = async (file: File) => {
      try {
        setIsUploading(true);

        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        // For markdown files, read content directly
        if (fileExtension === 'md' || fileExtension === 'markdown') {
          const content = await file.text();
          await handleCreateDocument(content, file.name.replace(/\.md$|\.markdown$/i, ''));
        }
        // For PDF and DOCX files, upload to server and parse
        else if (fileExtension === 'pdf' || fileExtension === 'docx') {
          const fileName = file.name.replace(/\.(pdf|docx)$/i, '');

          // Create optimistic document but don't select it yet
          const tempPageId = createOptimisticPage(fileName);

          try {
            // Upload file to server
            const uploadResult = await useFileStore.getState().uploadWithProgress({
              file,
              knowledgeBaseId,
            });

            if (!uploadResult) {
              throw new Error('Failed to upload file');
            }

            // Parse file as document on server - this creates a clean document from the file
            const { lambdaClient } = await import('@/libs/trpc/client');
            const parsedDocument = await lambdaClient.document.parseDocument.mutate({
              id: uploadResult.id,
            });

            // Convert to LobeDocument format
            const realPage = {
              content: parsedDocument.content || '',
              createdAt: parsedDocument.createdAt ? new Date(parsedDocument.createdAt) : new Date(),
              editorData:
                typeof parsedDocument.editorData === 'string'
                  ? JSON.parse(parsedDocument.editorData)
                  : parsedDocument.editorData || null,
              fileType: parsedDocument.fileType || 'custom/document',
              filename: parsedDocument.filename || fileName,
              id: parsedDocument.id,
              metadata: parsedDocument.metadata || {},
              source: parsedDocument.source || 'document',
              sourceType: parsedDocument.sourceType || 'file',
              title: parsedDocument.title || fileName,
              totalCharCount: parsedDocument.totalCharCount || 0,
              totalLineCount: parsedDocument.totalLineCount || 0,
              updatedAt: parsedDocument.updatedAt ? new Date(parsedDocument.updatedAt) : new Date(),
            };

            // Replace optimistic with real document in the store
            replaceTempPageWithReal(tempPageId, realPage);

            // Update selected page ID in store (with full ID including prefix)
            setSelectedPageId(parsedDocument.id, false);

            // Update URL with stripped ID (without prefix)
            const cleanId = standardizeIdentifier(parsedDocument.id);
            const newPath = cleanId ? `/page/${cleanId}` : '/page';
            window.history.replaceState({}, '', newPath);
          } catch (error) {
            console.error('Failed to upload and parse file:', error);
            // Remove temp document on error
            usePageStore.getState().removeTempPage(tempPageId);
            throw error;
          }
        }
      } catch (error) {
        console.error('Failed to upload file:', error);
      } finally {
        setIsUploading(false);
      }

      return false; // Prevent default upload behavior
    };

    return (
      <>
        <NavHeader />
        <Center gap={24} height={'100%'} style={{ paddingBottom: 100 }} width={'100%'}>
          {hasPages && (
            <Flexbox justify={'center'} style={{ textAlign: 'center' }}>
              <Text as={'h4'}>{t('pageEditor.empty.title')}</Text>
              <Text type={'secondary'}>{t('or', { ns: 'common' })}</Text>
            </Flexbox>
          )}
          <Flexbox horizontal gap={12}>
            <Flexbox
              className={styles.card}
              padding={16}
              onClick={() => handleCreateDocument('', t('pageList.untitled'))}
            >
              <span className={styles.actionTitle}>{t('pageEditor.empty.createNewDocument')}</span>
              <div className={styles.glow} style={{ background: cssVar.purple }} />
              <FileTypeIcon
                className={styles.icon}
                color={cssVar.purple}
                icon={<Icon color={'#fff'} icon={PlusIcon} />}
                size={ICON_SIZE}
                type={'file'}
              />
            </Flexbox>

            {/* Upload Files (PDF, DOCX, Markdown) */}
            <Upload
              accept=".md,.markdown,.pdf,.docx"
              beforeUpload={handleUploadFile}
              disabled={isUploading}
              multiple={false}
              showUploadList={false}
            >
              <Flexbox
                className={styles.card}
                padding={16}
                style={{ opacity: isUploading ? 0.5 : 1 }}
              >
                <span className={styles.actionTitle}>
                  {isUploading ? 'Uploading...' : t('pageEditor.empty.uploadFiles')}
                </span>
                <div className={styles.glow} style={{ background: cssVar.gold }} />
                <FileTypeIcon
                  className={styles.icon}
                  color={cssVar.gold}
                  icon={<Icon color={'#fff'} icon={ArrowUpIcon} />}
                  size={ICON_SIZE}
                  type={'file'}
                />
              </Flexbox>
            </Upload>

            {/* Import from Notion */}
            <Flexbox
              className={styles.card}
              padding={16}
              onClick={notionImport.handleOpenNotionGuide}
            >
              <span className={styles.actionTitle}>{t('pageEditor.empty.importNotion')}</span>
              <div className={styles.glow} style={{ background: cssVar.geekblue }} />
              <FileTypeIcon
                className={styles.icon}
                color={cssVar.geekblue}
                icon={<Notion color={'#fff'} />}
                size={ICON_SIZE}
                type={'file'}
              />
            </Flexbox>
          </Flexbox>
        </Center>
        <GuideModal
          cancelText={t('header.actions.notionGuide.cancel')}
          cover={<GuideVideo height={269} src={FILE_URL.importFromNotionGuide} width={358} />}
          desc={t('header.actions.notionGuide.desc')}
          okText={t('header.actions.notionGuide.ok')}
          open={notionImport.notionGuideOpen}
          title={t('header.actions.notionGuide.title')}
          onCancel={notionImport.handleCloseNotionGuide}
          onOk={notionImport.handleStartNotionImport}
        />
        <input
          accept=".zip"
          ref={notionImport.notionInputRef}
          style={{ display: 'none' }}
          type="file"
          onChange={handleNotionImportWithLocalUpdate}
        />
      </>
    );
  },
);

export default PageExplorerPlaceholder;
