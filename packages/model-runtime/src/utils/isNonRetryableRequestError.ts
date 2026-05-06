import { AgentRuntimeErrorType } from '../types/error';

const NON_RETRYABLE_ERROR_TYPES = new Set<string>([AgentRuntimeErrorType.ExceededContextWindow]);
const RETRYABLE_STATUS_CODES = new Set([401, 403, 404, 408, 409, 423, 425, 429]);
const RETRYABLE_ERROR_CODES = new Set([
  'accountdeactivated',
  'deploymentnotfound',
  'invalid_api_key',
  'invalidapikey',
  'invalidproviderapikey',
  'insufficient_quota',
  'model_not_found',
  'quota_exceeded',
  'rate_limit_exceeded',
]);
const NON_RETRYABLE_ERROR_CODES = new Set([
  'context_length_exceeded',
  'invalid_request_error',
  'invalid_schema',
  'invalid_type',
  'invalid_value',
  'json_schema_validation_error',
  'string_above_max_length',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  'api key',
  'billing',
  'capacity',
  'deploymentnotfound',
  'forbidden',
  'insufficient quota',
  'invalid api key',
  'invalidapikey',
  'invalidproviderapikey',
  'model not found',
  'overloaded',
  'permission denied',
  'quota',
  'rate limit',
  'temporarily unavailable',
  'timeout',
  'timed out',
  'too many requests',
  'unauthorized',
];

const NON_RETRYABLE_MESSAGE_PATTERNS = [
  'assistant message prefill',
  'conversation must end with a user message',
  'context length exceeded',
  'context_length_exceeded',
  'expected a string',
  'input is too long',
  'input tokens exceed',
  'invalid input',
  'invalid request',
  'invalid schema',
  'invalid schema for response_format',
  'invalid type for',
  'maximum allowed number of input tokens',
  'maximum context length',
  'maximum input length',
  'messages with role',
  'missing required parameter',
  'prompt is too long',
  'request too large for model',
  'response_format',
  'schema validation error',
  'string_above_max_length',
  'tool_choice',
  'tool_calls',
  'too many input tokens',
  'unsupported parameter',
  'unrecognized request argument',
];

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const collectErrorStrings = (
  value: unknown,
  visited = new WeakSet<object>(),
  depth = 0,
): string[] => {
  if (depth > 4 || value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];

  if (value instanceof Error) {
    return [
      value.name,
      value.message,
      ...collectErrorStrings(value.cause, visited, depth + 1),
    ].filter(Boolean);
  }

  const objectValue = toRecord(value);
  if (!objectValue) return [];
  if (visited.has(objectValue)) return [];
  visited.add(objectValue);

  const result: string[] = [];
  for (const [key, nestedValue] of Object.entries(objectValue)) {
    if (key === 'stack' || key === 'headers') continue;
    result.push(...collectErrorStrings(nestedValue, visited, depth + 1));
  }

  return result;
};

const collectStatusCodes = (
  value: unknown,
  visited = new WeakSet<object>(),
  depth = 0,
): number[] => {
  if (depth > 4 || value === undefined || value === null) return [];
  const objectValue = toRecord(value);
  if (!objectValue) return [];
  if (visited.has(objectValue)) return [];
  visited.add(objectValue);

  const result: number[] = [];
  for (const [key, nestedValue] of Object.entries(objectValue)) {
    const normalizedKey = key.toLowerCase();
    if (
      (normalizedKey === 'status' ||
        normalizedKey === 'statuscode' ||
        normalizedKey === 'httpstatuscode') &&
      typeof nestedValue === 'number'
    ) {
      result.push(nestedValue);
      continue;
    }

    result.push(...collectStatusCodes(nestedValue, visited, depth + 1));
  }

  return result;
};

export const isNonRetryableRequestError = (error: unknown): boolean => {
  const errorStrings = collectErrorStrings(error);
  const normalizedStrings = errorStrings.map((value) => value.toLowerCase());

  if (error && typeof error === 'object') {
    const errorType = (error as { errorType?: unknown }).errorType;
    if (typeof errorType === 'string' && NON_RETRYABLE_ERROR_TYPES.has(errorType)) return true;
  }

  if (normalizedStrings.some((value) => RETRYABLE_ERROR_CODES.has(value))) return false;
  if (normalizedStrings.some((value) => NON_RETRYABLE_ERROR_CODES.has(value))) return true;

  const combined = normalizedStrings.join('\n');
  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => combined.includes(pattern))) return false;
  if (NON_RETRYABLE_MESSAGE_PATTERNS.some((pattern) => combined.includes(pattern))) return true;

  const statusCodes = collectStatusCodes(error);
  if (statusCodes.some((statusCode) => RETRYABLE_STATUS_CODES.has(statusCode))) return false;

  return false;
};
