export type ToolErrorKind = 'replan' | 'retry' | 'stop';

interface ToolErrorSignal {
  code?: string;
  message: string;
  status?: number;
}

interface ClassifiedToolError {
  code?: string;
  kind: ToolErrorKind;
  message: string;
}

const RETRY_CODES = new Set(['RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'TOO_MANY_REQUESTS']);
const REPLAN_CODES = new Set([
  'BAD_REQUEST',
  'INVALID_ARGUMENT',
  'MANIFEST_NOT_FOUND',
  'MCP_CONFIG_NOT_FOUND',
  'MCP_EXECUTION_ERROR',
]);
const STOP_CODES = new Set([
  'FORBIDDEN',
  'INSUFFICIENT_PERMISSIONS',
  'NOT_IMPLEMENTED',
  'PERMISSION_DENIED',
  'UNAUTHORIZED',
]);

const RETRY_KEYWORDS = [
  'timeout',
  'timed out',
  'too many requests',
  'temporarily unavailable',
  'service unavailable',
  'network',
  'socket hang up',
  'econnreset',
  'econnrefused',
  'enotfound',
];
const REPLAN_KEYWORDS = [
  'invalid',
  'malformed',
  'schema',
  'parse',
  'not found',
  'missing required',
  'manifest not found',
  'not implemented',
];
const STOP_KEYWORDS = [
  'unauthorized',
  'forbidden',
  'permission denied',
  'api key',
  'quota',
  'billing',
  'not configured',
];

const hasAnyKeyword = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.includes(keyword));

const normalizeCode = (value?: string): string | undefined => {
  if (!value) return;

  return value
    .trim()
    .toUpperCase()
    .replaceAll(/[\s-]+/g, '_');
};

const tryExtractStatus = (message: string): number | undefined => {
  const matches = message.match(/\b([45]\d{2})\b/);
  if (!matches) return;

  const status = Number(matches[1]);
  return Number.isNaN(status) ? undefined : status;
};

const normalizeSignal = (error: unknown): ToolErrorSignal => {
  if (typeof error === 'string') {
    const message = error.toLowerCase();
    return { message, status: tryExtractStatus(message) };
  }

  if (error instanceof Error) {
    const message = (error.message || error.name || 'unknown error').toLowerCase();
    const raw = error as Error & { code?: string; status?: number; statusCode?: number };
    return {
      code: normalizeCode(raw.code),
      message,
      status:
        typeof raw.status === 'number'
          ? raw.status
          : typeof raw.statusCode === 'number'
            ? raw.statusCode
            : tryExtractStatus(message),
    };
  }

  if (error && typeof error === 'object') {
    const raw = error as {
      code?: string;
      error?: { code?: string; message?: string; status?: number; statusCode?: number };
      message?: string;
      status?: number;
      statusCode?: number;
    };

    const nestedCode = raw.error?.code;
    const nestedMessage = raw.error?.message;
    const message = (raw.message || nestedMessage || 'unknown error').toLowerCase();

    return {
      code: normalizeCode(raw.code || nestedCode),
      message,
      status:
        typeof raw.status === 'number'
          ? raw.status
          : typeof raw.statusCode === 'number'
            ? raw.statusCode
            : typeof raw.error?.status === 'number'
              ? raw.error.status
              : raw.error?.statusCode,
    };
  }

  return { message: 'unknown error' };
};

const classifyKind = ({ code, message, status }: ToolErrorSignal): ToolErrorKind => {
  if (code) {
    if (STOP_CODES.has(code)) return 'stop';
    if (REPLAN_CODES.has(code)) return 'replan';
    if (RETRY_CODES.has(code)) return 'retry';
  }

  if (status !== undefined) {
    if (status === 401 || status === 403) return 'stop';
    if (status === 400 || status === 404 || status === 409 || status === 422) return 'replan';
    if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
  }

  if (hasAnyKeyword(message, STOP_KEYWORDS)) return 'stop';
  if (hasAnyKeyword(message, REPLAN_KEYWORDS)) return 'replan';
  if (hasAnyKeyword(message, RETRY_KEYWORDS)) return 'retry';

  // Unknown failures may happen after a side effect already succeeded, so only
  // explicitly classified retryable errors should be replayed.
  return 'stop';
};

export const classifyToolError = (error: unknown): ClassifiedToolError => {
  const signal = normalizeSignal(error);

  return {
    code: signal.code,
    kind: classifyKind(signal),
    message: signal.message,
  };
};
