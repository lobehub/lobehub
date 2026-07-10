export type LLMErrorKind = 'retry' | 'stop';

export interface ClassifiedLLMError {
  code?: string;
  kind: LLMErrorKind;
  message: string;
}

export interface LLMErrorCodeSpecLike {
  code: string;
  retryable: boolean;
}

export interface LLMErrorClassifierOptions {
  errorCodeSpecs?: ReadonlyArray<LLMErrorCodeSpecLike | undefined>;
  getErrorCodeSpec?: (code: string) => LLMErrorCodeSpecLike | undefined;
  legacyStopErrorTypes?: readonly string[];
  retryOverrides?: readonly string[];
}

interface LLMErrorSignal {
  code?: string;
  errorType?: string;
  message: string;
  status?: number;
}

const DEFAULT_RETRY_OVERRIDES = [
  'AgentRuntimeError',
  'OllamaServiceUnavailable',
  'ProviderBizError',
  'StreamChunkError',
] as const;

const DEFAULT_LEGACY_STOP_ERROR_TYPES = ['Unauthorized'] as const;

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
// numeric `code` on the error object, with no `status`/`statusCode`.
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

const buildErrorTypeSets = (options: LLMErrorClassifierOptions) => {
  const retryOverrides = new Set(options.retryOverrides ?? DEFAULT_RETRY_OVERRIDES);
  const stop = new Set<string>();
  const retry = new Set<string>(retryOverrides);

  for (const spec of options.errorCodeSpecs ?? []) {
    if (!spec) continue;
    if (retryOverrides.has(spec.code)) continue;
    if (spec.retryable) retry.add(spec.code);
    else stop.add(spec.code);
  }

  for (const code of options.legacyStopErrorTypes ?? DEFAULT_LEGACY_STOP_ERROR_TYPES) {
    stop.add(code);
  }

  return { retry, retryOverrides, stop };
};

const createKindClassifier = (options: LLMErrorClassifierOptions = {}) => {
  const { retry: retryErrorTypes, stop: stopErrorTypes } = buildErrorTypeSets(options);

  return ({ code, errorType, message, status }: LLMErrorSignal): LLMErrorKind => {
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
      const canonical = options.getErrorCodeSpec?.(errorType)?.code ?? errorType;
      if (stopErrorTypes.has(canonical)) return 'stop';
      if (retryErrorTypes.has(canonical)) return 'retry';
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

export const createLLMErrorClassifier = (options: LLMErrorClassifierOptions = {}) => {
  const classifyKind = createKindClassifier(options);

  return (error: unknown): ClassifiedLLMError => {
    try {
      const signal = normalizeSignal(error);

      return {
        code: signal.code || signal.errorType,
        kind: classifyKind(signal),
        message: signal.message,
      };
    } catch {
      return {
        kind: 'stop',
        message: bestEffortMessage(error),
      };
    }
  };
};

export const classifyLLMError = createLLMErrorClassifier();
