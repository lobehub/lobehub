import { FILE_URL } from '@lobechat/business-const';
import debug from 'debug';
import { type TFunction } from 'i18next';
import { type ChangeEvent } from 'react';
import { useCallback, useRef } from 'react';

import { createGuideModal } from '@/components/GuideModal';
import GuideVideo from '@/components/GuideVideo';
import { type DocumentAction } from '@/store/file/slices/document/action';
import { unzipFile } from '@/utils/unzipFile';

const log = debug('resource:notion-import');

interface UseNotionImportOptions {
  createDocument: DocumentAction['createDocument'];
  currentFolderId?: string | null;
  libraryId?: string | null;
  refetchResources?: () => Promise<void>;
  t: TFunction<'file'>;
}

const useNotionImport = ({
  createDocument,
  currentFolderId,
  libraryId,
  refetchResources,
  t,
}: UseNotionImportOptions) => {
  const notionInputRef = useRef<HTMLInputElement>(null);

  const handleOpenNotionGuide = useCallback(() => {
    createGuideModal({
      cancelText: t('header.actions.notionGuide.cancel'),
      cover: <GuideVideo height={269} src={FILE_URL.importFromNotionGuide} width={358} />,
      desc: t('header.actions.notionGuide.desc'),
      okText: t('header.actions.notionGuide.ok'),
      onOk: () => {
        notionInputRef.current?.click();
      },
      title: t('header.actions.notionGuide.title'),
    });
  }, [t]);

  const handleNotionImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const { message } = await import('antd');

        const loadingKey = 'notion-import';
        message.loading({
          content: t('header.actions.notion.importing'),
          duration: 0,
          key: loadingKey,
        });

        let files = await unzipFile(file);

        log(
          'Extracted files (level 1):',
          files.map((f) => ({ name: f.name, type: f.type })),
        );

        const nestedZips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));

        if (nestedZips.length > 0) {
          log(
            'Found nested ZIPs, extracting...',
            nestedZips.map((z) => z.name),
          );
          const allNestedFiles: File[] = [];

          for (const zipFile of nestedZips) {
            try {
              const nestedFiles = await unzipFile(zipFile);
              log(
                `Extracted from ${zipFile.name}:`,
                nestedFiles.map((f) => ({ name: f.name, type: f.type })),
              );
              allNestedFiles.push(...nestedFiles);
            } catch (error) {
              console.error(`Failed to extract nested ZIP ${zipFile.name}:`, error);
            }
          }

          files = allNestedFiles;
        }

        log(
          'All extracted files:',
          files.map((f) => ({ name: f.name, type: f.type })),
        );

        const mdFiles = files.filter((f) => {
          const name = f.name.toLowerCase();
          return name.endsWith('.md') || name.endsWith('.markdown');
        });

        if (mdFiles.length === 0) {
          message.destroy(loadingKey);
          message.warning(
            t('header.actions.notion.noMarkdownFiles') +
              ` (${t('header.actions.notion.foundFiles', { count: files.length })})`,
          );
          log(
            'No markdown files found. All files:',
            files.map((f) => f.name),
          );
          return;
        }

        let successCount = 0;
        let failedCount = 0;

        for (const mdFile of mdFiles) {
          try {
            let content = await mdFile.text();
            let title = '';

            const lines = content.split('\n');
            const firstLine = lines[0]?.trim() || '';

            if (firstLine.startsWith('#')) {
              title = firstLine.replace(/^#+\s*/, '').trim();
              content = lines.slice(1).join('\n').trim();
            } else {
              const filename = mdFile.name.split('/').pop() || 'Untitled';
              title = filename.replace(/\.md$/, '');
            }

            await createDocument({
              content,
              knowledgeBaseId: libraryId ?? undefined,
              parentId: currentFolderId ?? undefined,
              title,
            });

            successCount++;
          } catch (error) {
            console.error(`Failed to import ${mdFile.name}:`, error);
            failedCount++;
          }
        }

        message.destroy(loadingKey);

        if (failedCount === 0) {
          message.success(
            t('header.actions.notion.success', {
              count: successCount,
            }),
          );
        } else {
          message.warning(
            t('header.actions.notion.partial', {
              failed: failedCount,
              success: successCount,
            }),
          );
        }

        await refetchResources?.();
      } catch (error) {
        console.error('Failed to import Notion export:', error);
        const { message } = await import('antd');
        message.error(t('header.actions.notion.error'));
      }

      event.target.value = '';
    },
    [createDocument, currentFolderId, libraryId, refetchResources, t],
  );

  return {
    handleNotionImport,
    handleOpenNotionGuide,
    notionInputRef,
  };
};

export default useNotionImport;
