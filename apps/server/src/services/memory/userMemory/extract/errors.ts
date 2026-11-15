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

/**
 * A readable one-line message for anything an extraction step throws.
 *
 * Model runtimes throw plain payloads such as `{ errorType, error, provider }` rather than
 * `Error`s, which used to surface as `[object Object]` or a generic "Extraction failed".
 */
export const describeError = (error: unknown, limit = 500): string => {
  const clip = (text: string) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
  if (error instanceof Error) return clip(error.message || error.name);
  if (typeof error === 'string') return clip(error);
  if (!error || typeof error !== 'object') return String(error ?? 'Unknown extraction error');

  const record = error as Record<string, unknown>;
  const inner = record.error;
  const innerMessage =
    getStringErrorProperty(inner, 'message') ??
    getStringErrorProperty((inner as { error?: unknown } | undefined)?.error, 'message');
  const message = getStringErrorProperty(record, 'message') ?? innerMessage;
  const prefix = [
    getStringErrorProperty(record, 'provider'),
    getStringErrorProperty(record, 'errorType'),
  ]
    .filter(Boolean)
    .join(' ');
  if (prefix || message) return clip([prefix, message].filter(Boolean).join(': '));

  try {
    return clip(JSON.stringify(error));
  } catch {
    return 'Unknown extraction error';
  }
};

// Failures that are the user's situation, not ours: an exhausted budget, or content the
// provider refuses to process. Recorded under their own type so dashboards can count them as
// skipped rather than as extraction failures.
const BUDGET_ERROR =
  /InsufficientBudgetForModel|FreePlanLimit|SubscriptionPlanLimit|Budget exceeded/;
const CONTENT_POLICY_ERROR =
  /ProviderContentPolicyViolation|ProviderContentModeration|PROHIBITED_CONTENT|content is prohibited|内容安全/;

/** The task error type for a failure that is not ours to fix, if it is one. */
export const classifyExtractionError = (message: string): AsyncTaskErrorType | undefined => {
  if (BUDGET_ERROR.test(message)) return AsyncTaskErrorType.SubscriptionPlanLimit;
  if (CONTENT_POLICY_ERROR.test(message)) return AsyncTaskErrorType.ProviderContentModeration;
  return undefined;
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
      name: classifyExtractionError(error.message) ?? AsyncTaskErrorType.ServerError,
    };
  }

  const message = describeError(error);
  return new AsyncTaskError(
    classifyExtractionError(message) ?? AsyncTaskErrorType.ServerError,
    message,
  );
};
