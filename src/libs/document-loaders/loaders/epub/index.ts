import { TempFileManager } from '@/server/utils/tempFileManager';
import { nanoid } from '@/utils/uuid';

import { DocumentChunkLimitError, splitText } from '../../splitter';
import { type DocumentChunk } from '../../types';
import { loaderConfig, MAX_DOCUMENT_CHUNKS } from '../config';

export const EPubLoader = async (content: Uint8Array): Promise<DocumentChunk[]> => {
  const tempManager = new TempFileManager('epub-');

  try {
    const tempPath = await tempManager.writeTempFile(content, `${nanoid()}.epub`);

    const { EPub } = await import('epub2');
    const htmlToText = await import('html-to-text');

    const epub = await EPub.createAsync(tempPath);
    const chapters = epub.flow || [];

    const documents: DocumentChunk[] = [];

    for (const chapter of chapters) {
      try {
        const html = await epub.getChapterRawAsync(chapter.id);
        const text = htmlToText.convert(html, {
          wordwrap: 80,
        });

        if (text.trim()) {
          const chunks = splitText(text, {
            ...loaderConfig,
            maxChunks: MAX_DOCUMENT_CHUNKS - documents.length,
          });
          for (const chunk of chunks) {
            documents.push({
              metadata: {
                ...chunk.metadata,
                source: 'blob',
              },
              pageContent: chunk.pageContent,
            });
          }
        }
      } catch (error) {
        if (error instanceof DocumentChunkLimitError) throw error;

        // Skip chapters that can't be parsed
      }
    }

    return documents;
  } catch (e) {
    throw new Error(`EPubLoader error: ${(e as Error).message}`, { cause: e });
  } finally {
    tempManager.cleanup();
  }
};
