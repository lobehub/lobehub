import { TempFileManager } from '@/server/utils/tempFileManager';
import { nanoid } from '@/utils/uuid';

import { splitText } from '../../splitter';
import { type DocumentChunk } from '../../types';
import { loaderConfig } from '../config';

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
          const chunks = splitText(text, loaderConfig);
          for (const chunk of chunks) {
            documents.push({
              metadata: {
                ...chunk.metadata,
                source: tempPath,
              },
              pageContent: chunk.pageContent,
            });
          }
        }
      } catch {
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
