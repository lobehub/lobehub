// Define supported file types - consider using an enum or const assertion
export type SupportedFileType = 'pdf' | 'doc' | 'docx' | 'txt' | 'excel' | 'pptx'; // | 'pptx' | 'latex' | 'epub' | 'code' | 'markdown';

/**
 * Represents a complete loaded file, including file-level information and all its pages/chunks.
 */
export interface FileDocument {
  /**
   * File content
   */
  content: string;

  /**
   * File creation timestamp.
   */
  createdTime: Date;

  /**
   * Original filename.
   */
  filename: string;

  /**
   * File type or extension.
   */
  fileType: string;

  /**
   * File-level metadata.
   * For example, title and author extracted from file properties, or errors when the entire file loading fails.
   */
  metadata: {
    /**
     * Allows adding other file-level metadata.
     */
    [key: string]: any;
    /**
     * Document author (if available).
     */
    author?: string;
    /**
     * If the entire file loading fails, record error information.
     */
    error?: string;
    /**
     * Document title (if available).
     */
    title?: string;
  };

  /**
   * File last modified timestamp.
   */
  modifiedTime: Date;

  /**
   * Array containing all logical pages/chunks in the document.
   * The order typically corresponds to the natural order in the file.
   */
  pages?: DocumentPage[];

  /**
   * Full path of the original file.
   */
  source: string;

  /**
   * Total character count of the entire document (sum of all Page charCounts).
   * Needs to be calculated after all Pages are loaded and computed.
   */
  totalCharCount: number;

  /**
   * Total line count of the entire document (sum of all Page lineCounts).
   * Needs to be calculated after all Pages are loaded and computed.
   */
  totalLineCount: number;
}

/**
 * Represents a logical unit/page/chunk in a file.
 */
export interface DocumentPage {
  /**
   * Character count of this page/chunk content.
   */
  charCount: number;

  /**
   * Line count of this page/chunk content.
   */
  lineCount: number;

  /**
   * Metadata related to this page/chunk.
   */
  metadata: {
    /**
     * Allows adding other page/chunk-specific metadata.
     */
    [key: string]: any;

    /**
     * If the original file unit is further divided into chunks, this is the index of the current chunk.
     */
    chunkIndex?: number;

    /**
     * Error that occurred when processing this page/chunk.
     */
    error?: string;

    /**
     * Ending line number of this page/chunk in the original file.
     */
    lineNumberEnd?: number;

    /**
     * Starting line number of this page/chunk in the original file.
     */
    lineNumberStart?: number;

    /**
     * Page number (applicable for PDF, DOCX).
     */
    pageNumber?: number;

    /**
     * Section title related to this page/chunk.
     */
    sectionTitle?: string;

    /**
     * Sheet name (applicable for XLSX).
     */
    sheetName?: string;

    /**
     * Slide number (applicable for PPTX).
     */
    slideNumber?: number;

    /**
     * If the original file unit is further divided into chunks, this is the total number of chunks for that unit.
     */
    totalChunks?: number;
  };

  /**
   * Core text content of this page/chunk.
   */
  pageContent: string;
}

/**
 * Optional file metadata used to override information read from the filesystem.
 */
export interface FileMetadata {
  /**
   * File creation timestamp.
   */
  createdTime?: Date;
  /**
   * Filename.
   */
  filename?: string;
  /**
   * File type or extension.
   */
  fileType?: string;
  /**
   * File last modified timestamp.
   */
  modifiedTime?: Date;
  /**
   * File source identifier (e.g., S3 URL or original path).
   */
  source?: string;
}

/**
 * Defines the interface that all file loader classes must implement.
 */
export interface FileLoaderInterface {
  /**
   * Aggregates the page content obtained from loadPages into a single string.
   * @param pages Array of DocumentPage objects.
   * @returns Promise that returns the aggregated text content.
   */
  aggregateContent: (pages: DocumentPage[]) => Promise<string>;

  attachDocumentMetadata?: (filePath: string) => Promise<Record<string, any>>;

  /**
   * Loads file content based on the file path and splits it into logical pages/chunks.
   * @param filePath Full path of the file.
   * @returns Promise that returns an array containing DocumentPage objects.
   */
  loadPages: (filePath: string) => Promise<DocumentPage[]>;
}
