import { pickString, toRecord } from '@lobechat/utils/object';

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
  'CONTENT_POLICY_VIOLATION',
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

const normalizeCode = (value?: unknown): string | undefined => {
  const code = typeof value === 'number' ? String(value) : pickString(value);
  if (!code) return;

  return code
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

const DENIAL_CODES = new Set([
  '403',
  'CONTENT_POLICY_VIOLATION',
  'FORBIDDEN',
  'INSUFFICIENT_PERMISSIONS',
  'PERMISSION_DENIED',
]);
const GENERIC_ERROR_CODES = new Set([
  '403',
  'CLOUD_MCP_EXECUTION_ERROR',
  'LOBEHUB_SKILL_ERROR',
  'MCP_EXECUTION_ERROR',
]);

/**
 * A transport refusal must explain the next action in the model-visible content.
 * A bare 403 cannot identify whether authorization or request filtering rejected
 * the call, so never infer a content policy or a matched rule from its message.
 */
export const getToolAccessDeniedError = (error: unknown, fallbackMessage: string) => {
  const raw = toRecord(error);
  const nested = toRecord(toRecord(raw?.errorBody)?.error) || toRecord(raw?.error);
  const signal = normalizeSignal(error || fallbackMessage);
  const code = normalizeCode(nested?.code) || signal.code;
  const bareForbidden = /^\s*(?:403[ :-]*)?forbidden\s*$/i;
  const message =
    pickString(raw?.message) ||
    pickString(nested?.message) ||
    pickString(error) ||
    fallbackMessage ||
    'Tool access was denied';

  if (signal.status !== 403 && !DENIAL_CODES.has(code || '') && !bareForbidden.test(message)) {
    return;
  }

  return {
    code: code && !GENERIC_ERROR_CODES.has(code) ? code : 'FORBIDDEN',
    doc_url: pickString(raw?.doc_url) || pickString(nested?.doc_url),
    hint:
      pickString(raw?.hint) ||
      pickString(nested?.hint) ||
      'Do not retry this call or encode/split its arguments to bypass the refusal. Ask the user or administrator to check tool permissions and upstream request filtering. The upstream response did not identify the blocking rule.',
    kind: 'stop' as const,
    message,
    status: signal.status,
  };
};
