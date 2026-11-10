import type { MemoryExtractionTraceError } from '@lobechat/types';

import type { AsyncTaskErrorBody, AsyncTaskStructuredErrorItem } from '@/types/asyncTask';
import { AsyncTaskError, AsyncTaskErrorType } from '@/types/asyncTask';

const getStringErrorProperty = (error: unknown, key: string) => {
  if (!error || typeof error !== 'object') return undefined;

  const value = (error as Record<string, unknown>)[key];

  return typeof value === 'string' ? value : undefined;
};

const getErrorCause = (error: unknown) => {
  if (!error || typeof error !== 'object') return undefined;

  return (error as { cause?: unknown }).cause;
};

export const serializeError = (
  error: unknown,
): AsyncTaskStructuredErrorItem & MemoryExtractionTraceError => {
  if (error instanceof Error) {
    const cause = getErrorCause(error);

    return {
      cause: cause ? serializeError(cause) : undefined,
      code: getStringErrorProperty(error, 'code'),
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
};

type MemoryExtractionErrorStage = 'extract' | 'persist' | 'retrieval';

export interface MemoryExtractionTaskErrorItem extends AsyncTaskStructuredErrorItem {
  stage: MemoryExtractionErrorStage;
}

export class MemoryExtractionAggregateError extends Error {
  readonly items: MemoryExtractionTaskErrorItem[];

  constructor(message: string, items: MemoryExtractionTaskErrorItem[]) {
    super(message);
    this.items = items;
    this.name = 'MemoryExtractionAggregateError';
  }
}

const summarizeUnknown = (value: unknown, limit = 500) => {
  if (value === undefined) return undefined;
  if (typeof value === 'string')
    return value.length > limit ? `${value.slice(0, limit)}...` : value;

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return undefined;

    return serialized.length > limit ? `${serialized.slice(0, limit)}...` : serialized;
  } catch {
    return String(value);
  }
};

/**
 * Serializes a memory extraction error for async task persistence.
 *
 * Use when:
 * - Recording extraction, persistence, or retrieval failures on async tasks
 * - Preserving wrapped database/runtime error causes for production debugging
 *
 * Expects:
 * - Error inputs may be plain values, `Error` instances, or errors with nested `cause`
 *
 * Returns:
 * - A JSON-safe task error item with stage/source context and nested cause details
 */
export const makeTaskErrorItem = (
  stage: MemoryExtractionErrorStage,
  error: unknown,
  options: {
    layer?: string;
    memoryIndex?: number;
    preview?: unknown;
    sourceId?: string;
    sourceType?: string;
  } = {},
): MemoryExtractionTaskErrorItem => {
  const serialized = serializeError(error);

  return {
    layer: options.layer,
    memoryIndex: options.memoryIndex,
    cause: serialized.cause,
    code: serialized.code,
    message: serialized.message,
    name: serialized.name,
    preview: options.preview ? summarizeUnknown(options.preview) : undefined,
    sourceId: options.sourceId,
    sourceType: options.sourceType,
    stack: serialized.stack,
    stage,
  };
};

const buildAsyncTaskStructuredError = (
  detail: string,
  items: MemoryExtractionTaskErrorItem[],
): AsyncTaskErrorBody => ({
  detail,
  extractErrors: items.filter((item) => item.stage === 'extract'),
  persistErrors: items.filter((item) => item.stage === 'persist'),
  retrievalErrors: items.filter((item) => item.stage === 'retrieval'),
});

export const buildAsyncTaskErrorFrom = (
  error: unknown,
): AsyncTaskError | { body: AsyncTaskErrorBody; name: string } => {
  if (error instanceof MemoryExtractionAggregateError) {
    return {
      body: buildAsyncTaskStructuredError(error.message, error.items),
      name: AsyncTaskErrorType.ServerError,
    };
  }

  return new AsyncTaskError(
    AsyncTaskErrorType.ServerError,
    error instanceof Error ? error.message : 'Extraction failed',
  );
};
