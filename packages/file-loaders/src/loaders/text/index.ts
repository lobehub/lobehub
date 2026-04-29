import { readFile } from 'node:fs/promises';

import debug from 'debug';

import type { DocumentPage, FileLoaderInterface } from '../../types';

const log = debug('file-loaders:text');

const HEURISTIC_SAMPLE_BYTES = 512;
const HEURISTIC_THRESHOLD = 0.3;

type Utf16Variant = 'utf-16le' | 'utf-16be';

/**
 * Detect UTF-16 without BOM by sampling and counting ASCII-shaped code-unit
 * pairs. ASCII chars in UTF-16 produce a 0x00 byte at the high half: at
 * odd index for LE, at even index for BE.
 */
const detectUtf16NoBom = (buffer: Buffer): Utf16Variant | null => {
  const sample = buffer.subarray(0, Math.min(HEURISTIC_SAMPLE_BYTES, buffer.length));
  if (sample.length < 4 || sample.length % 2 !== 0) return null;

  let leAsciiPairs = 0;
  let beAsciiPairs = 0;
  const totalPairs = sample.length / 2;

  for (let i = 0; i < sample.length; i += 2) {
    const lo = sample[i];
    const hi = sample[i + 1];
    if (hi === 0x00 && lo !== 0x00) leAsciiPairs++;
    else if (lo === 0x00 && hi !== 0x00) beAsciiPairs++;
  }

  if (leAsciiPairs > beAsciiPairs && leAsciiPairs / totalPairs >= HEURISTIC_THRESHOLD) {
    return 'utf-16le';
  }
  if (beAsciiPairs > leAsciiPairs && beAsciiPairs / totalPairs >= HEURISTIC_THRESHOLD) {
    return 'utf-16be';
  }
  return null;
};

/**
 * Read a text file with automatic encoding detection.
 * Detects UTF-8, UTF-16LE, and UTF-16BE via BOM, with a heuristic fallback
 * for UTF-16 without BOM (common in some Windows exports). Falls back to UTF-8.
 */
const readTextFile = async (filePath: string): Promise<string> => {
  const buffer = await readFile(filePath);

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    log('Detected UTF-16LE BOM');
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    log('Detected UTF-16BE BOM');
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    log('Detected UTF-8 BOM');
    return buffer.subarray(3).toString('utf8');
  }

  const variant = detectUtf16NoBom(buffer);
  if (variant) {
    log('Detected %s without BOM (heuristic)', variant);
    return new TextDecoder(variant).decode(buffer);
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
