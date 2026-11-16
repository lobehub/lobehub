// Entry of the parse worker thread (bundled by scripts/buildFileParseWorker.mts). One thread per
// task: the job arrives in `workerData`, the outcome goes back as one message. It runs parsers
// that can hold the CPU for tens of seconds, which is why it is not on the request thread.
// Keep the imports to parsing libraries: no document service, DB or tenant code.
import { parentPort, workerData } from 'node:worker_threads';

import { detectFormat, parseDataset } from '@lobechat/eval-dataset-parser';
import { isFileParseBudgetError, loadFile, UnsupportedFileTypeError } from '@lobechat/file-loaders';
import { preflightXlsxZip } from '@lobechat/file-loaders/src/xlsxBudget';

import { ChunkingLoader } from '@/libs/document-loaders';

import { capParsedFileDocument, stripPageWrappers } from '../document/parsedFileCap';
import { assertChunkResultWithinLimits, ChunkOutputTooLargeError } from './chunkLimits';
import { assertFileLoaded } from './loadedFile';
import type { FileParseJob, FileParseWorkerMessage, SerializedWorkerError } from './protocol';
import {
  BUDGET_ERROR_NAME,
  OUTPUT_TOO_LARGE_ERROR_NAME,
  UNSUPPORTED_FILE_TYPE_ERROR_NAME,
} from './protocol';

/**
 * Same format decision `parseDataset` makes (explicit format, else file name, else the bytes),
 * so an xlsx cannot reach SheetJS without the zip preflight by naming or auto-detecting around it.
 */
const runDataset = async (job: Extract<FileParseJob, { kind: 'dataset' }>) => {
  const { content, options } = job;
  const format =
    options?.format && options.format !== 'auto'
      ? options.format
      : detectFormat(content, options?.filename);
  if (format === 'xlsx' && typeof content !== 'string') await preflightXlsxZip(content);
  return parseDataset(content, options);
};

/**
 * The knowledge-base splitter, on the raw loader: never the wrapper that sends the job here (that
 * would queue the job behind itself). An xlsx passes the zip preflight inside `ExcelLoader`, before
 * exceljs inflates anything. The result is measured, not cut: it is copied back to the request
 * thread whole or the job fails.
 */
const runChunk = async (job: Extract<FileParseJob, { kind: 'chunk' }>) =>
  assertChunkResultWithinLimits(
    await new ChunkingLoader().partitionContent(job.filename, job.content),
  );

const runJob = async (job: FileParseJob) => {
  if (job.kind === 'dataset') return runDataset(job);
  if (job.kind === 'chunk') return runChunk(job);

  const loaded = assertFileLoaded(await loadFile(job.filePath));
  return capParsedFileDocument(job.mode === 'document' ? stripPageWrappers(loaded) : loaded);
};

const serializeError = (error: unknown): SerializedWorkerError => {
  if (error instanceof ChunkOutputTooLargeError) {
    return { message: error.message, name: OUTPUT_TOO_LARGE_ERROR_NAME };
  }
  if (error instanceof UnsupportedFileTypeError) {
    return {
      fileType: error.fileType,
      message: error.message,
      name: UNSUPPORTED_FILE_TYPE_ERROR_NAME,
    };
  }
  if (isFileParseBudgetError(error)) {
    return {
      budget: { actual: error.actual, limit: error.limit, reason: error.reason },
      message: error.message,
      name: BUDGET_ERROR_NAME,
    };
  }
  const { message, name } = error instanceof Error ? error : new Error(String(error));
  return { message, name };
};

const port = parentPort;
if (!port) throw new Error('fileParseWorker must run inside a worker thread');

runJob(workerData as FileParseJob).then(
  (value) => port.postMessage({ type: 'result', value } satisfies FileParseWorkerMessage),
  (error) =>
    port.postMessage({
      error: serializeError(error),
      type: 'error',
    } satisfies FileParseWorkerMessage),
);
