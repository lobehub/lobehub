import { readFile } from 'node:fs/promises';

import debug from 'debug';

import type { DocumentPage, FileLoaderInterface } from '../../types';

const log = debug('file-loaders:text');

/**
 * Loader for loading plain text files.
 */
export class TextLoader implements FileLoaderInterface {
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading text file:', filePath);
    try {
      const fileContent = await readFile(filePath, 'utf8');
      log('Text file loaded successfully, size:', fileContent.length, 'bytes');
      const lines = fileContent.split('\n');
      const lineCount = lines.length;
      const charCount = fileContent.length;
      log('Text file stats:', { charCount, lineCount });

      const page: DocumentPage = {
        charCount,
        lineCount,
        metadata: {
          lineNumberEnd: lineCount,
          lineNumberStart: 1,
        },
        pageContent: fileContent,
      };

      log('Text page created successfully');
      return [page];
    } catch (e) {
      const error = e as Error;
      log('Error encountered while loading text file');
      console.error(`Error loading text file ${filePath}: ${error.message}`);
      // If reading fails, return a Page containing error information
      const errorPage: DocumentPage = {
        charCount: 0,
        lineCount: 0,
        metadata: {
          error: `Failed to load text file: ${error.message}`,
        },
        pageContent: '',
      };
      log('Created error page for failed text file loading');
      return [errorPage];
    }
  }

  /**
   * For plain text, simply concatenate the content of all pages.
   * (Although TextLoader typically has only one page, this maintains interface consistency)
   * @param pages Array of pages
   * @returns Aggregated content
   */
  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    log('Aggregating content from', pages.length, 'text pages');
    // By default, join with newline separator, can be adjusted or made configurable as needed
    const result = pages.map((page) => page.pageContent).join('\n');
    log('Content aggregated successfully, length:', result.length);
    return result;
  }
}
