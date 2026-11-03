import fs from 'node:fs/promises';

import debug from 'debug';
import mammoth from 'mammoth';

import type { DocumentPage, FileLoaderInterface } from '../../types';

const log = debug('file-loaders:docx');

/**
 * Loads Word documents (.docx) using mammoth library.
 * Extracts text content and basic metadata from DOCX files.
 */
export class DocxLoader implements FileLoaderInterface {
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading DOCX file:', filePath);
    try {
      // Read file as buffer
      const buffer = await fs.readFile(filePath);
      log('File buffer read, size:', buffer.length);

      // Extract text using mammoth
      const result = await mammoth.extractRawText({ buffer });
      const pageContent = result.value;
      log('Text extracted, length:', pageContent.length);

      // Count lines and characters
      const lines = pageContent.split('\n');
      const lineCount = lines.length;
      const charCount = pageContent.length;

      log('DOCX document processed, lines:', lineCount, 'chars:', charCount);

      // Create single page with extracted content
      const page: DocumentPage = {
        charCount,
        lineCount,
        metadata: {
          pageNumber: 1,
        },
        pageContent,
      };

      // Handle warnings if any
      if (result.messages.length > 0) {
        const warnings = result.messages.filter((msg) => msg.type === 'warning');
        if (warnings.length > 0) {
          log('Extraction warnings:', warnings.length);
          warnings.forEach((warning) => log('Warning:', warning.message));
        }
      }

      log('DOCX loading completed');
      return [page];
    } catch (e) {
      const error = e as Error;
      log('Error encountered while loading DOCX file');
      console.error(`Error loading DOCX file ${filePath}: ${error.message}`);

      const errorPage: DocumentPage = {
        charCount: 0,
        lineCount: 0,
        metadata: {
          error: `Failed to load DOCX file: ${error.message}`,
        },
        pageContent: '',
      };
      log('Created error page for failed DOCX loading');
      return [errorPage];
    }
  }

  /**
   * Aggregates content from DOCX pages.
   * Uses double newline as a separator.
   * @param pages Array of DocumentPage objects.
   * @returns Aggregated content as a string.
   */
  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    log('Aggregating content from', pages.length, 'DOCX pages');
    const result = pages.map((page) => page.pageContent).join('\n\n');
    log('DOCX content aggregated successfully, length:', result.length);
    return result;
  }
}
