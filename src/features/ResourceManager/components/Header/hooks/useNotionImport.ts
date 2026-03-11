import debug from 'debug';
import { type TFunction } from 'i18next';
import { type ChangeEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

import { type DocumentAction } from '@/store/file/slices/document/action';
import { unzipFile } from '@/utils/unzipFile';

const log = debug('resource:notion-import');

interface UseNotionImportOptions {
  createDocument: DocumentAction['createDocument'];
  currentFolderId?: string | null;
  libraryId?: string | null;
  refetchResources: () => Promise<void>;
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
  const [notionGuideOpen, setNotionGuideOpen] = useState(false);

  const handleOpenNotionGuide = useCallback(() => {
    setNotionGuideOpen(true);
  }, []);

  const handleCloseNotionGuide = useCallback(() => {
    setNotionGuideOpen(false);
  }, []);

  const handleStartNotionImport = useCallback(() => {
    notionInputRef.current?.click();
    setNotionGuideOpen(false);
  }, []);

  const handleNotionImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const { message } = await import('antd');

        // Show loading message
        const loadingKey = 'notion-import';
        message.loading({
          content: t('header.actions.notion.importing'),
          duration: 0,
          key: loadingKey,
        });

        // Unzip the file
        let files = await unzipFile(file);

        log(
          'Extracted files (level 1):',
          files.map((f) => ({ name: f.name, type: f.type })),
        );

        // Check if there are nested ZIP files (common in Notion exports)
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

          // Replace files with nested content
          files = allNestedFiles;
        }

        log(
          'All extracted files:',
          files.map((f) => ({ name: f.name, type: f.type })),
        );

        // Filter for markdown files (case-insensitive, support both .md and .markdown)
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

        // Process each markdown file
        let successCount = 0;
        let failedCount = 0;

        for (const mdFile of mdFiles) {
          try {
            // Read file content
            let content = await mdFile.text();
            let title = '';

            // Check if first line is a heading (# Title)
            const lines = content.split('\n');
            const firstLine = lines[0]?.trim() || '';

            if (firstLine.startsWith('#')) {
              // Extract title from heading (remove # symbols and trim)
              title = firstLine.replace(/^#+\s*/, '').trim();
              // Remove the first line from content
              content = lines.slice(1).join('\n').trim();
            } else {
              // Fallback to filename without extension
              const filename = mdFile.name.split('/').pop() || 'Untitled';
              title = filename.replace(/\.md$/, '');
            }

            // Create document
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

        // Show completion message
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

        // Refetch resources to show imported documents
        await refetchResources();
      } catch (error) {
        console.error('Failed to import Notion export:', error);
        const { message } = await import('antd');
        message.error(t('header.actions.notion.error'));
      }

      // Reset input to allow re-uploading
      event.target.value = '';
    },
    [createDocument, currentFolderId, libraryId, refetchResources, t],
  );

  return {
    handleCloseNotionGuide,
    handleNotionImport,
    handleOpenNotionGuide,
    handleStartNotionImport,
    notionGuideOpen,
    notionInputRef,
  };
};

export default useNotionImport;
