import path from 'node:path';

import debug from 'debug';

import type { DocumentPage, FileLoaderInterface } from '../../types';
import type { ExtractedFile } from '../../utils/parser-utils';
import { extractFiles, parseString } from '../../utils/parser-utils';

const log = debug('file-loaders:pptx');

/**
 * Represents a loader for PPTX files using extracted utility functions.
 *
 * This loader reads a PPTX file, extracts text content from each slide,
 * and represents each slide as a `DocumentPage`.
 */
export class PptxLoader implements FileLoaderInterface {
  /**
   * Loads pages from the specified PPTX file path.
   *
   * @param filePath The absolute path to the PPTX file.
   * @returns A Promise resolving to an array of `DocumentPage` objects.
   *          If loading or parsing fails, it returns an array containing a single
   *          `DocumentPage` object with error information in its metadata.
   */
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading PPTX file:', filePath);
    const sourceFileName = path.basename(filePath);
    log('Source file name:', sourceFileName);

    try {
      // --- File Extraction Step ---
      const slidesRegex = /ppt\/slides\/slide\d+\.xml/g;
      const slideNumberRegex = /slide(\d+)\.xml/;

      log('Extracting slide XML files from PPTX');
      // Extract only slide XML files
      const slideFiles: ExtractedFile[] = await extractFiles(filePath, (fileName) =>
        slidesRegex.test(fileName),
      );
      log('Extracted slide files:', slideFiles.length);

      // --- Validation Step ---
      if (slideFiles.length === 0) {
        log('No slide XML files found in the PPTX file');
        console.warn(`No slide XML files found in ${sourceFileName}. May be corrupted or empty.`);
        return [
          this.createErrorPage(
            'No slides found. The PPTX file might be empty, corrupted, or does not contain standard slide XMLs.',
            sourceFileName,
          ),
        ];
      }

      // --- Sorting Step ---
      log('Sorting slide files by slide number');
      // Sort files based on the slide number extracted from the path
      slideFiles.sort((a, b) => {
        const matchA = a.path.match(slideNumberRegex);
        const matchB = b.path.match(slideNumberRegex);
        const numA = matchA ? parseInt(matchA[1], 10) : Infinity;
        const numB = matchB ? parseInt(matchB[1], 10) : Infinity;
        return numA - numB;
      });
      log('Slide files sorted');

      // --- Page Creation Step ---
      log('Creating document pages from slide files');
      const pages: DocumentPage[] = slideFiles
        .map((slideFile, index) => {
          try {
            log(`Processing slide ${index + 1}/${slideFiles.length}, path: ${slideFile.path}`);
            const xmlDoc = parseString(slideFile.content);
            const paragraphNodes = xmlDoc.getElementsByTagName('a:p');
            log(`Found ${paragraphNodes.length} paragraph nodes in slide ${index + 1}`);

            const slideText = Array.from(paragraphNodes)
              .map((pNode) => {
                const textNodes = pNode.getElementsByTagName('a:t');
                return Array.from(textNodes)
                  .map((tNode) => (tNode.childNodes[0] ? tNode.childNodes[0].nodeValue : ''))
                  .join(''); // Join text within a paragraph without spaces
              })
              .filter((text) => text.length > 0) // Filter out empty paragraphs
              .join('\n'); // Join paragraphs with newline

            const lines = slideText.split('\n');
            const slideNumberMatch = slideFile.path.match(slideNumberRegex);
            const slideNumber = slideNumberMatch ? parseInt(slideNumberMatch[1], 10) : index + 1; // Fallback to index if regex fails
            log(
              `Slide ${index + 1} text extracted, lines: ${lines.length}, characters: ${slideText.length}`,
            );

            const metadata = {
              pageCount: slideFiles.length, // Total number of slides found
              slideNumber: slideNumber,
              sourceFileName,
            };

            return {
              charCount: slideText.length,
              lineCount: lines.length,
              metadata: metadata,
              pageContent: slideText.trim(), // Trim final content
            };
          } catch (parseError) {
            log(`Error parsing slide ${slideFile.path}`);
            console.error(
              `Failed to parse XML for slide ${slideFile.path} in ${sourceFileName}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
            // Create a specific error page for this slide, or could return null and filter later
            // Returning null might be better if one slide fails but others succeed.
            // For now, let's keep it simple and create an error page for this slide.
            return this.createErrorPage(
              `Error parsing slide ${slideFile.path}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              sourceFileName,
              slideFile.path,
            );
          }
        })
        // Filter out any potential nulls if we change the error handling above
        .filter((page): page is DocumentPage => page !== null);
      log(`Created ${pages.length} document pages from slides`);

      if (pages.length === 0) {
        // This case might happen if all slides failed to parse
        log('Parsing resulted in zero valid pages');
        console.warn(`Parsing resulted in zero valid pages for ${sourceFileName}`);
        return [this.createErrorPage('Parsing resulted in zero valid pages.', sourceFileName)];
      }

      // Check if all pages are error pages
      const allErrored = pages.every((page) => page.metadata?.error);
      if (allErrored) {
        // If all pages resulted in errors, perhaps return a single summary error
        log('All slides failed to parse');
        console.warn(`All slides failed to parse for ${sourceFileName}`);
        return [this.createErrorPage('All slides failed to parse correctly.', sourceFileName)];
        // Or return all the individual error pages: return pages;
      }

      log('PPTX loading completed successfully');
      return pages;
    } catch (error) {
      // --- Error Handling Step ---
      // This catches errors from extractFiles or other unexpected issues
      log('Error loading or processing PPTX file');
      const errorMessage = `Failed to load or process PPTX file: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMessage, { filePath });
      return [this.createErrorPage(errorMessage, sourceFileName)];
    }
  }

  /**
   * Aggregates the content from all DocumentPages (slides).
   *
   * Prepends each slide's content with a "## Slide: N" header.
   * Joins the content of slides with a standard separator.
   *
   * @param pages An array of `DocumentPage` objects obtained from `loadPages`.
   * @returns A Promise resolving to the aggregated content string.
   */
  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    log('Aggregating content from', pages.length, 'PPTX pages');
    // Ensure pages array is valid and non-empty before proceeding
    // Filter out error pages before aggregation unless we want to include error messages
    const validPages = pages.filter((page) => !page.metadata?.error);
    log(
      `Found ${validPages.length} valid pages for aggregation (${pages.length - validPages.length} error pages filtered out)`,
    );

    if (validPages.length === 0) {
      // If only error pages existed, return empty or a summary error message
      log('No valid pages found, returning content of first page (may be error page)');
      return pages[0]?.pageContent || ''; // Return content of the first page (might be an error page)
    }

    const result = validPages
      .map((page) => {
        const slideNumber = page.metadata?.slideNumber;
        // Use Markdown H2 for slide headers
        const header = slideNumber ? `<slide_page pageNumber="${slideNumber}">` : '<slide_page>'; // Fallback header
        return `${header}
${page.pageContent}
</slide_page>`;
      })
      .join('\n\n'); // Use Markdown horizontal rule as separator

    log('PPTX content aggregated successfully, length:', result.length);
    return result;
  }

  /**
   * Helper method to create a standardized error page object.
   *
   * @param errorInfo A string describing the error.
   * @param sourceFileName The name of the file that caused the error.
   * @param sourceFilePath Optional: Specific path within the archive that caused the error (e.g., slide path)
   * @returns A `DocumentPage` object representing the error state.
   */
  private createErrorPage(
    errorInfo: string,
    sourceFileName: string,
    sourceFilePath?: string,
  ): DocumentPage {
    log('Creating error page:', errorInfo);
    return {
      charCount: 0,
      lineCount: 0,
      metadata: {
        error: errorInfo,
        pageCount: 0,
        sourceFileName: sourceFileName,
        ...(sourceFilePath && { sourceFilePath }), // Add specific path if available
      },
      pageContent: '', // Error pages have no content
    };
  }
}
