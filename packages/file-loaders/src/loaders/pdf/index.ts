import { readFile } from 'node:fs/promises';

import debug from 'debug';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import * as _pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';

import type { DocumentPage, FileLoaderInterface } from '../../types';
import { promptTemplate } from './prompt';

const log = debug('file-loaders:pdf');

/**
 * Loads PDF files page by page using the official pdfjs-dist library.
 */
export class PdfLoader implements FileLoaderInterface {
  private pdfInstance: PDFDocumentProxy | null = null;
  private pdfjsWorker = _pdfjsWorker;

  private async getPDFFile(filePath: string) {
    // GlobalWorkerOptions.workerSrc should have been set at the module level.
    // We are now relying on pdfjs-dist to use this path when it creates a worker.

    log('Reading PDF file:', filePath);
    const dataBuffer = await readFile(filePath);
    log('PDF file read successfully, size:', dataBuffer.length, 'bytes');

    const loadingTask = getDocument({
      data: new Uint8Array(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.length),
      useSystemFonts: true,
    });

    log('PDF document loading task created');
    const pdf = await loadingTask.promise;
    log('PDF document loaded successfully, pages:', pdf.numPages);
    return pdf;
  }

  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Starting to load PDF pages from:', filePath);
    try {
      const pdf: PDFDocumentProxy = await this.getPDFFile(filePath);

      const pages: DocumentPage[] = [];
      log(`Processing ${pdf.numPages} PDF pages`);

      for (let i = 1; i <= pdf.numPages; i += 1) {
        log(`Loading page ${i}/${pdf.numPages}`);
        const page: PDFPageProxy = await pdf.getPage(i);
        const content: TextContent = await page.getTextContent();
        log(`Page ${i} text content retrieved, items:`, content.items.length);

        // --- Revert to EXACT Simple Langchain PDFLoader Logic ---
        let lastY;
        const textItems = [];
        for (const item of content.items) {
          // Ensure 'str' exists and potentially filter empty strings if needed, though Langchain's snippet doesn't explicitly filter empties
          if ('str' in item) {
            if (lastY === item.transform[5] || !lastY) {
              // Exact check from Langchain
              textItems.push(item.str);
            } else {
              // Exact else from Langchain for Y change
              textItems.push(`\n${item.str}`);
            }
            // Update lastY, Langchain's snippet doesn't use destructuring here
            lastY = item.transform[5];
          }
        }

        const pageText = textItems.join(''); // Join with empty separator
        // --- End Revert to Simple Langchain Logic ---

        // Clean the final text (keep null character removal)
        const cleanedPageContent = pageText.replaceAll('\0', '');

        // Calculate stats based on the final content
        const pageLines = cleanedPageContent.split('\n');
        const lineCount = pageLines.length;
        const charCount = cleanedPageContent.length;
        log(`Page ${i} processed, lines: ${lineCount}, chars: ${charCount}`);

        pages.push({
          charCount,
          lineCount,
          metadata: { pageNumber: i },
          pageContent: cleanedPageContent,
        });

        // Clean up page resources
        log(`Cleaning up page ${i} resources`);
        page.cleanup();
      }

      // Clean up document resources
      log('Cleaning up PDF document resources');
      await pdf.destroy();

      log(`PDF loading completed for ${filePath}, total pages:`, pages.length);
      return pages;
    } catch (e) {
      const error = e as Error;
      log('Error encountered while loading PDF file');
      console.error(
        `Error loading PDF file ${filePath} using pdfjs-dist: ${error.message}`,
        error.stack,
      );
      const errorPage: DocumentPage = {
        charCount: 0,
        lineCount: 0,
        metadata: {
          error: `Failed to load or parse PDF file: ${error.message}`,
          filePath: filePath,
        },
        pageContent: '',
      };
      log('Created error page for failed PDF loading');
      return [errorPage];
    }
  }

  /**
   * Aggregates content from PDF pages.
   * Uses double newline as a separator.
   * @param pages Array of DocumentPage objects.
   * @returns Aggregated content as a string.
   */
  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    log('Aggregating content from', pages.length, 'PDF pages');
    const validPages = pages.filter((page) => !page.metadata.error);
    log(
      `Found ${validPages.length} valid pages for aggregation (${pages.length - validPages.length} pages with errors filtered out)`,
    );

    const result = promptTemplate(validPages);
    log('PDF content aggregated successfully, length:', result.length);
    return result;
  }

  async attachDocumentMetadata(filePath: string): Promise<any> {
    log('Attaching document metadata for PDF:', filePath);
    const pdf: PDFDocumentProxy = await this.getPDFFile(filePath);

    log('Getting PDF metadata');
    const pdfMetadata =
      (await pdf.getMetadata().catch((err) => {
        log('Error retrieving PDF metadata');
        console.error(`Error getting PDF metadata: ${err.message}`);
        return null;
      })) ?? null;

    const pdfInfo = pdfMetadata?.info ?? {};
    const metadata = pdfMetadata?.metadata ?? null;
    log('PDF metadata retrieved:', {
      hasInfo: !!Object.keys(pdfInfo).length,
      hasMetadata: !!metadata,
    });

    return {
      pdfInfo: pdfInfo,
      // PDF info (Author, Title, etc.)
      pdfMetadata: metadata,
      // PDF metadata
      pdfVersion: version,
    };
  }
}
