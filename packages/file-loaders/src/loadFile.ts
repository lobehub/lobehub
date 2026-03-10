import { stat } from 'node:fs/promises';
import * as path from 'node:path';

import debug from 'debug';

import { getFileLoader } from './loaders';
import type { DocumentPage, FileDocument, FileMetadata, SupportedFileType } from './types';
import { isTextReadableFile } from './utils/isTextReadableFile';

const log = debug('file-loaders:loadFile');

/**
 * Determines the file type based on the filename extension.
 * @param filePath The path to the file.
 * @returns The determined file type or 'txt' if text-readable, undefined otherwise.
 */
const getFileType = (filePath: string): SupportedFileType | undefined => {
  log('Determining file type for:', filePath);
  const extension = path.extname(filePath).toLowerCase().replace('.', '');

  if (!extension) {
    log('No extension found, treating as txt');
    return 'txt'; // Treat files without extension as text?
  }

  // Prioritize checking if it's a generally text-readable type
  if (isTextReadableFile(extension)) {
    log(`Extension '${extension}' is text-readable, treating as txt`);
    return 'txt';
  }

  // Handle specific non-text or complex types
  log(`Checking specific types for extension: '${extension}'`);
  switch (extension) {
    case 'pdf': {
      log('File type identified as pdf');
      return 'pdf';
    }
    case 'doc': {
      log('File type identified as doc');
      return 'doc';
    }
    case 'docx': {
      log('File type identified as docx');
      return 'docx';
    }
    case 'xlsx':
    case 'xls': {
      log('File type identified as excel');
      return 'excel';
    }
    case 'pptx': {
      log('File type identified as pptx');
      return 'pptx';
    }
    default: {
      log(
        `Extension '${extension}' is not a specifically handled type and not text-readable. Unsupported.`,
      );
      // If not text-readable and not a specific known type, it's unsupported
      return undefined;
    }
  }
};

/**
 * Loads a file from the specified path, automatically detecting the file type
 * and using the appropriate loader class.
 *
 * @param filePath The path to the file to load.
 * @param fileMetadata Optional metadata to override information read from the filesystem.
 * @returns A Promise resolving to a FileDocument object.
 */
export const loadFile = async (
  filePath: string,
  fileMetadata?: FileMetadata,
): Promise<FileDocument> => {
  log('Starting to load file:', filePath, 'with metadata:', fileMetadata);
  let stats;
  let fsError: string | undefined;

  try {
    log('Attempting to get file stats for:', filePath);
    stats = await stat(filePath);
    log('Successfully retrieved file stats:', stats);
  } catch (e) {
    const error = e as Error;
    log('Error getting file stats for %s: %s', filePath, error.message);
    console.error(`Error getting file stats for ${filePath}: ${error.message}`);
    fsError = `Failed to access file stats: ${error.message}`;
  }

  // Determine base file info from path and stats (if available)
  log('Determining base file info');
  const fileExtension = path.extname(filePath).slice(1).toLowerCase();
  const baseFilename = path.basename(filePath);

  // Apply overrides from fileMetadata or use defaults
  const source = fileMetadata?.source ?? filePath;
  const filename = fileMetadata?.filename ?? baseFilename;
  const fileType = fileMetadata?.fileType ?? fileExtension;
  const createdTime = fileMetadata?.createdTime ?? stats?.ctime ?? new Date();
  const modifiedTime = fileMetadata?.modifiedTime ?? stats?.mtime ?? new Date();
  log('File info determined/overridden: %O', {
    createdTime,
    fileType,
    filename,
    modifiedTime,
    source,
  });

  const parserType = getFileType(filePath);
  log('Parser type determined as:', parserType);

  // Use lazy loading to get the loader class - this prevents heavy dependencies
  // like pdfjs-dist from being loaded until they're actually needed
  const loaderType = parserType ?? 'txt';
  const LoaderClass = await getFileLoader(loaderType);
  log('Selected loader class:', LoaderClass.name);

  if (!parserType) {
    console.warn(
      `No specific loader found for file type '${fileType}'. Using default loader (TextLoader) as fallback.`,
    );
  }

  let pages: DocumentPage[] = [];
  let aggregatedContent = '';
  let loaderError: string | undefined;
  let aggregationError: string | undefined;
  let metadataError: string | undefined;
  let loaderSpecificMetadata: any | undefined;

  // Instantiate the loader
  log('Instantiating loader:', LoaderClass.name);
  const loaderInstance = new LoaderClass();

  // If we couldn't even get stats, skip loader execution
  if (!fsError) {
    log('File stats available, proceeding with loader execution.');
    try {
      // 1. Load pages using the instance
      log('Loading pages with loader:', LoaderClass.name, 'for file:', filePath);
      pages = await loaderInstance.loadPages(filePath);
      log('Pages loaded successfully, count:', pages.length);

      try {
        // 2. Aggregate content using the instance
        log('Aggregating content with loader:', LoaderClass.name);
        aggregatedContent = await loaderInstance.aggregateContent(pages);
        log('Content aggregated successfully, length:', aggregatedContent.length);
      } catch (aggError) {
        const error = aggError as Error;
        console.error(
          `Error aggregating content for ${filePath} using ${LoaderClass.name}: ${error.message}`,
        );
        aggregationError = `Content aggregation failed: ${error.message}`;
        // Keep the pages loaded, but content might be empty/incomplete
      }

      // 3. Attach document-specific metadata if loader supports it
      if (typeof loaderInstance.attachDocumentMetadata === 'function') {
        log('Loader supports attachDocumentMetadata. Attaching...');
        try {
          loaderSpecificMetadata = await loaderInstance.attachDocumentMetadata(filePath);
          log('Document-specific metadata attached:', loaderSpecificMetadata);
        } catch (metaErr) {
          const error = metaErr as Error;
          console.error(
            `Error attaching metadata for ${filePath} using ${LoaderClass.name}: ${error.message}`,
          );
          metadataError = `Metadata attachment failed: ${error.message}`;
        }
      } else {
        log('Loader does not support attachDocumentMetadata.');
      }
    } catch (loadErr) {
      const error = loadErr as Error;
      console.error(
        `Error loading pages for ${filePath} using ${LoaderClass.name}: ${error.message}`,
      );
      loaderError = `Loader execution failed: ${error.message}`;
      // Provide a minimal error page if loader failed critically
      pages = [
        {
          charCount: 0,
          lineCount: 0,
          metadata: { error: loaderError },
          pageContent: '',
        },
      ];
      // Aggregated content remains empty
    }
  } else {
    log('File stats access failed (fsError: %s). Creating minimal error page.', fsError);
    // If stats failed, create a minimal error page
    pages = [
      {
        charCount: 0,
        lineCount: 0,
        metadata: { error: fsError },
        pageContent: '',
      },
    ];
    // Aggregated content remains empty
  }

  // Calculate totals from the loaded pages
  let totalCharCount = 0;
  let totalLineCount = 0;
  log('Calculating total char and line counts from pages.');
  for (const page of pages) {
    totalCharCount += page.charCount;
    totalLineCount += page.lineCount;
  }
  log('Totals calculated:', { totalCharCount, totalLineCount });

  // Combine all potential errors
  const combinedError =
    [fsError, loaderError, aggregationError, metadataError].filter(Boolean).join('; ') || undefined;
  if (combinedError) log('Combined errors:', combinedError);

  // Construct the final FileDocument
  log('Constructing final FileDocument.');
  const fileDocument: FileDocument = {
    content: aggregatedContent, // Use content from aggregateContent
    createdTime,
    fileType,
    filename,
    metadata: {
      // Include combined errors
      error: combinedError,
      // Add loader specific metadata under a namespace
      loaderSpecific: loaderSpecificMetadata ?? undefined,
      // Add other file-level metadata
      ...fileMetadata,
    },
    modifiedTime,
    pages, // Use pages from loadPages
    source,
    totalCharCount,
    totalLineCount,
  };

  // Clean up undefined error field if no error occurred
  if (!fileDocument.metadata.error) {
    delete fileDocument.metadata.error;
  }

  log('File loading process completed for:', filePath, 'Returning document:', {
    fileType: fileDocument.fileType,
    filename: fileDocument.filename,
    pages: fileDocument.pages?.length,
  });
  return fileDocument;
};
