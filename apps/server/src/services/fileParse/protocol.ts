// Shared by the main-thread runner and the worker entry. Types and constants only: the worker
// bundle imports this file, so it must stay free of runtime dependencies.
import type { FileDocument, FileParseBudgetReason } from '@lobechat/file-loaders';

import type { DocumentChunk } from '@/libs/document-loaders/types';

export type FileParseMode = 'document' | 'file';

export interface DatasetParseOptions {
  csvDelimiter?: string;
  filename?: string;
  format?: 'auto' | 'csv' | 'json' | 'jsonl' | 'xlsx';
  headerRow?: number;
  preview?: number;
  sheet?: number | string;
}

/** What a worker thread is asked to do. Local path or content plus options: no credentials, no DB. */
export type FileParseJob =
  /** Knowledge-base chunking: file name and bytes in, `DocumentChunk[]` out. No DB, no env routing. */
  | { content: Uint8Array; filename: string; kind: 'chunk' }
  | { content: Uint8Array | string; kind: 'dataset'; options?: DatasetParseOptions }
  | { filePath: string; kind: 'file'; mode: FileParseMode };

export interface SerializedWorkerError {
  /** Set for a budget refusal: structure only, no file content. */
  budget?: { actual: number; limit: number; reason: FileParseBudgetReason };
  fileType?: string;
  message: string;
  name: string;
}

export type FileParseWorkerMessage =
  | { error: SerializedWorkerError; type: 'error' }
  | { type: 'result'; value: DocumentChunk[] | FileDocument | unknown };

/** Error names the worker may report; the runner maps them back to typed errors. */
export const UNSUPPORTED_FILE_TYPE_ERROR_NAME = 'UnsupportedFileTypeError';
export const LOAD_FAILED_ERROR_NAME = 'FileLoadFailedError';
export const BUDGET_ERROR_NAME = 'FileParseBudgetError';
export const OUTPUT_TOO_LARGE_ERROR_NAME = 'FileParseOutputTooLargeError';
