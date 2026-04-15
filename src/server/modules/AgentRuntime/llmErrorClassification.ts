type LLMErrorKind = 'retry' | 'stop';

interface ClassifiedLLMError {
  code?: string;
  kind: LLMErrorKind;
  message: string;
}

interface LLMErrorSignal {
  code?: string;
  errorType?: string;
  message: string;
  status?: number;
}

const RETRY_ERROR_TYPES = new Set([
  'AgentRuntimeError',
  'OllamaServiceUnavailable',
  'ProviderBizError',
  'QuotaLimitReached',
  'StreamChunkError',
]);
const STOP_ERROR_TYPES = new Set([
  'AccountDeactivated',
  'ExceededContextWindow',
  'InsufficientQuota',
  'InvalidBedrockCredentials',
  'InvalidGithubCopilotToken',
  'InvalidGithubToken',
  'InvalidOllamaArgs',
  'InvalidProviderAPIKey',
  'InvalidVertexCredentials',
  'ModelNotFound',
  'PermissionDenied',
  'Unauthorized',
]);

const RETRY_KEYWORDS = [
  '429',
  'connection',
  'econn',
  'network',
  'rate limit',
  'timeout',
  'timed out',
  'temporarily unavailable',
];
const STOP_KEYWORDS = [
  '403',
  'context window',
  'api key',
  'billing',
  'forbidden',
  'insufficient quota',
  'invalid request',
  'maximum context length',
  'model not found',
  'permission denied',
  'payload',
  'too many tokens',
  'unauthorized',
];

const hasAnyKeyword = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.includes(keyword));

const normalizeCode = (value?: unknown): string | undefined => {
  if (typeof value !== 'string' || !value) return;

  return value
    .trim()
    .toUpperCase()
    .replaceAll(/[\s-]+/g, '_');
};

const normalizeErrorType = (value?: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const tryExtractStatus = (message: string) => {
  const matches = message.match(/\b([45]\d{2})\b/);
  if (!matches) return;

  const status = Number(matches[1]);
  return Number.isNaN(status) ? undefined : status;
};

// Some providers (notably bare HTTP proxies) only surface the HTTP status as a
// numeric `code` on the error object, with no `status`/`statusCode`. Treat
// those numeric codes as status so classifyKind can still map 401/403 to stop
// and 429/5xx to retry without falling through to message-keyword matching.
const numericStatusFromCode = (...codes: unknown[]): number | undefined => {
  for (const code of codes) {
    if (typeof code === 'number' && Number.isFinite(code)) return code;
  }
  return undefined;
};

const normalizeSignal = (error: unknown): LLMErrorSignal => {
  if (typeof error === 'string') {
    const message = error.toLowerCase();
    return { message, status: tryExtractStatus(message) };
  }

  if (error instanceof Error) {
    const raw = error as Error & {
      code?: unknown;
      errorType?: unknown;
      status?: number;
      statusCode?: number;
      type?: unknown;
    };
    const message = (raw.message || raw.name || 'unknown error').toLowerCase();

    return {
      code: normalizeCode(raw.code),
      errorType: normalizeErrorType(raw.errorType || raw.type),
      message,
      status:
        typeof raw.status === 'number'
          ? raw.status
          : typeof raw.statusCode === 'number'
            ? raw.statusCode
            : (numericStatusFromCode(raw.code) ?? tryExtractStatus(message)),
    };
  }

  if (error && typeof error === 'object') {
    const raw = error as {
      code?: unknown;
      error?: {
        code?: unknown;
        error?: { code?: unknown; message?: string; status?: number; type?: unknown };
        errorType?: unknown;
        message?: string;
        status?: number;
        type?: unknown;
      };
      errorType?: unknown;
      message?: string;
      status?: number;
      statusCode?: number;
      type?: unknown;
    };
    const nested = raw.error;
    const nestedError = nested?.error;
    const message = (
      raw.message ||
      nested?.message ||
      nestedError?.message ||
      'unknown error'
    ).toLowerCase();

    return {
      code: normalizeCode(raw.code || nested?.code || nestedError?.code),
      errorType: normalizeErrorType(
        raw.errorType || raw.type || nested?.errorType || nested?.type || nestedError?.type,
      ),
      message,
      status:
        typeof raw.status === 'number'
          ? raw.status
          : typeof raw.statusCode === 'number'
            ? raw.statusCode
            : typeof nested?.status === 'number'
              ? nested.status
              : typeof nestedError?.status === 'number'
                ? nestedError.status
                : (numericStatusFromCode(raw.code, nested?.code, nestedError?.code) ??
                  tryExtractStatus(message)),
    };
  }

  return { message: 'unknown error' };
};

const classifyKind = ({ code, errorType, message, status }: LLMErrorSignal): LLMErrorKind => {
  if (errorType === 'ProviderBizError') {
    if (status === 400 || status === 422) return 'stop';
    if (message.includes('invalid_request_error') || message.includes('invalid request')) {
      return 'stop';
    }
    if (
      message.includes('input_schema') ||
      message.includes('field required') ||
      message.includes('missing required')
    ) {
      return 'stop';
    }
  }

  if (errorType) {
    if (STOP_ERROR_TYPES.has(errorType)) return 'stop';
    if (RETRY_ERROR_TYPES.has(errorType)) return 'retry';
  }

  if (code) {
    if (code.includes('UNAUTHORIZED') || code.includes('FORBIDDEN')) return 'stop';
    if (code.includes('MODEL_NOT_FOUND')) return 'stop';
    if (code.includes('RATE_LIMIT') || code.includes('TIMEOUT')) return 'retry';
  }

  if (status !== undefined) {
    if (status === 401 || status === 403) return 'stop';
    if (status === 400 || status === 404 || status === 409 || status === 422) return 'stop';
    if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
  }

  if (hasAnyKeyword(message, STOP_KEYWORDS)) return 'stop';
  if (hasAnyKeyword(message, RETRY_KEYWORDS)) return 'retry';

  return 'retry';
};

/**
 * Extract a human-readable message for the fallback path without relying on
 * normalizeSignal (which might be the thing that just threw).
 */
const bestEffortMessage = (error: unknown): string => {
  try {
    if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }
    if (typeof error === 'string' && error.length > 0) return error;
    if (error && typeof error === 'object') {
      const e = error as { message?: unknown; error?: { message?: unknown } };
      if (typeof e.message === 'string' && e.message.length > 0) return e.message;
      const nested = e.error?.message;
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }
  } catch {
    // Property access itself can throw (e.g. hostile Proxy). Fall through to default.
  }
  return 'unknown error';
};

export const classifyLLMError = (error: unknown): ClassifiedLLMError => {
  // Defensive: a classifier that throws would mask the original provider error
  // behind the classifier's own TypeError (e.g. `e.trim is not a function`),
  // making prod debugging impossible. If anything below throws, fall back to a
  // conservative "stop" decision that preserves the original error message.
  try {
    const signal = normalizeSignal(error);

    return {
      code: signal.code || signal.errorType,
      kind: classifyKind(signal),
      message: signal.message,
    };
  } catch (classificationError) {
    return {
      kind: 'stop',
      message: bestEffortMessage(error),
    };
  }
};

export type { ClassifiedLLMError, LLMErrorKind };
