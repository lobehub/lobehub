import { readFile } from 'node:fs/promises';

import debug from 'debug';

import type { DocumentPage, FileLoaderInterface } from '../../types';

const log = debug('file-loaders:text');

/**
 * Read a text file with automatic encoding detection based on BOM.
 * Supports UTF-8, UTF-16LE, and UTF-16BE. Falls back to UTF-8 if no BOM is found.
 */
const readTextFile = async (filePath: string): Promise<string> => {
  const buffer = await readFile(filePath);

  // Detect BOM and decode accordingly
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    log('Detected UTF-16LE BOM');
    return buffer.subarray(2).toString('utf16le');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    log('Detected UTF-16BE BOM');
    // Node.js doesn't have built-in utf16be, swap bytes then decode as utf16le
    const content = buffer.subarray(2);
    for (let i = 0; i < content.length - 1; i += 2) {
      const temp = content[i];
      content[i] = content[i + 1];
      content[i + 1] = temp;
    }
    return content.toString('utf16le');
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    log('Detected UTF-8 BOM');
    return buffer.subarray(3).toString('utf8');
  }

  // No BOM detected — heuristic check for UTF-16LE without BOM
  // (common in some Windows exports: ASCII content will have \0 after every byte)
  if (buffer.length >= 4 && buffer[1] === 0x00 && buffer[3] === 0x00) {
    log('Detected UTF-16LE without BOM (heuristic)');
    return buffer.toString('utf16le');
  }

  return buffer.toString('utf8');
};

/**
 * Loader for loading plain text files.
 */
export class TextLoader implements FileLoaderInterface {
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading text file:', filePath);
    try {
      const fileContent = await readTextFile(filePath);
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
