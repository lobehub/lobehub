import debug from 'debug';
import WordExtractor from 'word-extractor';

import type { DocumentPage, FileLoaderInterface } from '../../types';

const log = debug('file-loaders:doc');

/**
 * Loads legacy Word documents (.doc) using word-extractor.
 * Extracts plain text content and basic metadata from DOC files.
 */
export class DocLoader implements FileLoaderInterface {
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading DOC file:', filePath);
    try {
      const extractor = new WordExtractor();
      const extracted: any = await extractor.extract(filePath);

      // Prefer getBody() if available; fallback to common fields
      const hasGetBody = extracted && typeof extracted.getBody === 'function';
      const read = (name: string): string =>
        typeof extracted?.[name] === 'function' ? ((extracted[name]() as string) ?? '') : '';

      // getBody() is only the main story. A .doc keeps text boxes, footnotes and
      // endnotes in streams of their own, and Word puts all of them on the page,
      // so reading the body alone drops every callout, pull quote and footnote.
      // Comments stay out: they are remarks about the document, not part of it.
      const asides = [read('getTextboxes'), read('getFootnotes'), read('getEndnotes')]
        .map((part) => part.trim())
        .filter(Boolean);

      const body = hasGetBody ? read('getBody') : ((extracted?.text as string) ?? '');
      // A document whose text lives only in a text box has an empty body, and
      // keeping it would open the content with two blank lines.
      const pageContent: string = asides.length
        ? [body.trimEnd(), ...asides].filter(Boolean).join('\n\n')
        : body;

      const lines = pageContent.split('\n');
      const lineCount = lines.length;
      const charCount = pageContent.length;

      const page: DocumentPage = {
        charCount,
        lineCount,
        metadata: { pageNumber: 1 },
        pageContent,
      };

      log('DOC loading completed');
      return [page];
    } catch (e) {
      const error = e as Error;
      log('Error encountered while loading DOC file');
      console.error(`Error loading DOC file ${filePath}: ${error.message}`);

      const errorPage: DocumentPage = {
        charCount: 0,
        lineCount: 0,
        metadata: { error: `Failed to load DOC file: ${error.message}` },
        pageContent: '',
      };
      return [errorPage];
    }
  }

  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    log('Aggregating content from', pages.length, 'DOC pages');
    return pages.map((p) => p.pageContent).join('\n\n');
  }
}
