import { AsyncResource } from 'node:async_hooks';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { FileDocument } from '@lobechat/file-loaders';
import debug from 'debug';

import { FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE, MAX_FILE_PARSE_SIZE } from '@/const/file';
import type { DocumentChunk } from '@/libs/document-loaders/types';
import { noteActivity, withActivity } from '@/server/modules/RuntimeActivity';

import { resolveFileParseWorkerPath } from './artifact';
import { FileParseError } from './errors';
import type { DatasetParseOptions, FileParseJob, FileParseMode } from './protocol';
import type { FileParseRunner } from './runner';
import { createFileParseRunner } from './runner';

export { FileParseError } from './errors';

const log = debug('lobe-chat:service:file-parse');

/** A parse slower than this is worth a log line; faster ones stay at debug level. */
const SLOW_PARSE_LOG_MS = 5000;

const SHARED_RUNNER_KEY = Symbol.for('lobehub.fileParse.sharedRunner');

/**
 * One runner per OS process, kept on `globalThis`: Next bundles each route separately and dev HMR
 * reloads modules, so a module-level variable would give every copy its own slot and queue and the
 * pod would run several parses at once. The runner holds only counters and queued jobs for the
 * lifetime of single parses; nothing tenant- or request-scoped outlives a task.
 */
export const getSharedFileParseRunner = (): FileParseRunner => {
  const holder = globalThis as { [SHARED_RUNNER_KEY]?: FileParseRunner };
  return (holder[SHARED_RUNNER_KEY] ??= createFileParseRunner({
    workerPath: resolveFileParseWorkerPath,
  }));
};

interface TrackedParse {
  bytes?: number;
  fileId?: string;
  format?: string;
  job: FileParseJob;
}

/**
 * Every parse runs inside an activity: a stalled loop or a lease fence names what was parsing,
 * without the content, the temp path or any credential. One structured line records the outcome,
 * and only failures and slow parses are logged above debug level.
 */
const track = <T>({ bytes, fileId, format, job }: TrackedParse): Promise<T> =>
  withActivity(
    'file-parse',
    job.kind === 'file' ? job.mode : job.kind,
    { bytes, fileId, format, phase: 'queued' },
    async () => {
      const startedAt = performance.now();
      let parseStartedAt: number | undefined;
      const onStart = AsyncResource.bind(() => {
        parseStartedAt = performance.now();
        noteActivity({ phase: 'parsing' });
      });

      const report = (outcome: string, error?: unknown) => {
        const now = performance.now();
        // A task that never started (queue full, queue timeout) only has waiting time: its whole
        // life is `queuedMs` and `parseMs` is 0, so a 30s queue wait is not read as a 30s parse.
        const parseStarted = parseStartedAt ?? now;
        const line = {
          bytes,
          code: (error as { code?: string } | undefined)?.code,
          event: `file_parse.${outcome}`,
          fileId,
          format,
          parseMs: Math.round(now - parseStarted),
          queuedMs: Math.round(parseStarted - startedAt),
        };
        if (outcome === 'failed') console.warn(JSON.stringify(line));
        else if (line.parseMs >= SLOW_PARSE_LOG_MS) console.info(JSON.stringify(line));
        else log('%O', line);
      };

      try {
        // Authoritative or measured size, checked before anything is cloned into a thread.
        if (bytes !== undefined && bytes > MAX_FILE_PARSE_SIZE) {
          throw new FileParseError('INPUT_TOO_LARGE', FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE);
        }
        const value = await getSharedFileParseRunner().run<T>(job, { onStart });
        report('completed');
        return value;
      } catch (error) {
        report('failed', error);
        throw error;
      }
    },
  );

const statBytes = async (filePath: string) => {
  try {
    return (await stat(filePath)).size;
  } catch {
    return undefined;
  }
};

/**
 * Parses a downloaded file on a worker thread. `mode: 'document'` drops the `<page>` wrappers
 * (page editor text); both modes apply the stored-content cap inside the worker.
 * Rejects with `UnsupportedFileTypeError` for unsupported types and `FileParseError` otherwise.
 */
export const parseFileInWorker = async (
  filePath: string,
  options: { fileId?: string; mode: FileParseMode },
): Promise<FileDocument> =>
  track<FileDocument>({
    bytes: await statBytes(filePath),
    fileId: options.fileId,
    format: path.extname(filePath).slice(1).toLowerCase() || undefined,
    job: { filePath, kind: 'file', mode: options.mode },
  });

/** Parses an eval dataset (CSV/JSON/JSONL/XLSX) on a worker thread, under the same limits. */
export const parseDatasetInWorker = <T>(
  content: Uint8Array | string,
  options?: DatasetParseOptions,
): Promise<T> =>
  track<T>({
    bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength,
    format:
      options?.format && options.format !== 'auto'
        ? options.format
        : path
            .extname(options?.filename ?? '')
            .slice(1)
            .toLowerCase() || undefined,
    job: { content, kind: 'dataset', options },
  });

/**
 * Splits a knowledge-base file into chunks on a worker thread, under the same slot, queue and
 * limits as every other parse. Only bytes and a file name cross the boundary, and only
 * `DocumentChunk[]` comes back: the database and the knowledge routing stay on the caller's thread.
 * A result over the chunk bounds is rejected (`OUTPUT_TOO_LARGE`), never truncated.
 */
export const chunkContentInWorker = (
  filename: string,
  content: Uint8Array,
  options?: { fileId?: string },
): Promise<DocumentChunk[]> =>
  track<DocumentChunk[]>({
    bytes: content.byteLength,
    fileId: options?.fileId,
    format: path.extname(filename).slice(1).toLowerCase() || undefined,
    job: { content, filename, kind: 'chunk' },
  });
