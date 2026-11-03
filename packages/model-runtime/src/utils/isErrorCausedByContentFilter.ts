interface ContentFilterErrorPayloadLike {
  choices?: unknown;
  code?: unknown;
  error?: unknown;
  finish_reason?: unknown;
  type?: unknown;
}

const CONTENT_FILTER_SIGNAL_VALUES = new Set(['content_filter', 'content_policy_violation']);

const isContentFilterSignalValue = (value: unknown) =>
  typeof value === 'string' && CONTENT_FILTER_SIGNAL_VALUES.has(value.toLowerCase());

/**
 * Detects content-filter failures from structured provider error fields.
 *
 * Use when:
 * - Converting OpenAI-compatible provider errors to runtime error types
 * - Deciding whether router fallback should stop for a blocked prompt
 *
 * Expects:
 * - Provider payloads may nest structured signals under `error`
 * - Chat completion payloads may expose `choices[].finish_reason`
 *
 * Returns:
 * - `true` only when `code`, `type`, or `finish_reason` carries a known content-filter signal
 */
export const isErrorCausedByContentFilter = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const payload = error as ContentFilterErrorPayloadLike;
  if (
    isContentFilterSignalValue(payload.code) ||
    isContentFilterSignalValue(payload.type) ||
    isContentFilterSignalValue(payload.finish_reason)
  )
    return true;

  if (
    Array.isArray(payload.choices) &&
    payload.choices.some((choice) => isErrorCausedByContentFilter(choice))
  )
    return true;

  return (
    Boolean(payload.error) &&
    typeof payload.error === 'object' &&
    isErrorCausedByContentFilter(payload.error)
  );
};
