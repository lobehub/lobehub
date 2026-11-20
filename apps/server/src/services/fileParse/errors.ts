export type FileParseErrorCode =
  /** The input is larger than the in-memory parse cap; refused before any worker starts. */
  | 'INPUT_TOO_LARGE'
  /** The loader read the file but produced no usable content (all pages failed). */
  | 'LOAD_FAILED'
  /** The worker ran out of its heap limit. */
  | 'OUT_OF_MEMORY'
  /** The parse succeeded but its result is too big to copy back; never truncated silently. */
  | 'OUTPUT_TOO_LARGE'
  /** Waiting list is full: rejected at once, no worker started. */
  | 'QUEUE_FULL'
  /** Waited too long for a free slot. */
  | 'QUEUE_TIMEOUT'
  /** The thread could not be created. */
  | 'START_FAILED'
  /** The parse exceeded its time budget and the worker was terminated. */
  | 'TIMEOUT'
  /** The worker artifact is missing: never falls back to parsing on the main thread. */
  | 'UNAVAILABLE'
  /** The worker threw outside the parse, or exited without reporting a result. */
  | 'WORKER_FAILED'
  /** The parse itself raised an error (corrupt file, loader exception). */
  | 'PARSE_FAILED';

export class FileParseError extends Error {
  readonly code: FileParseErrorCode;

  constructor(code: FileParseErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FileParseError';
    this.code = code;
  }

  /** Saturation, not a bad file: the same request can succeed later. */
  get retryable() {
    return this.code === 'QUEUE_FULL' || this.code === 'QUEUE_TIMEOUT';
  }
}

/**
 * Name/code based, not `instanceof`: the shared runner lives on `globalThis` and may have been
 * created by another bundle copy (a different Next route bundle, an HMR reload), whose
 * `FileParseError` class is not the one the caller imports.
 */
export const isFileParseError = (error: unknown): error is FileParseError =>
  error instanceof FileParseError ||
  (error instanceof Error &&
    error.name === 'FileParseError' &&
    typeof (error as { code?: unknown }).code === 'string');

/** Name based for the same cross-copy reason as {@link isFileParseError}. */
export const isUnsupportedFileTypeError = (error: unknown): error is Error =>
  error instanceof Error && error.name === 'UnsupportedFileTypeError';
