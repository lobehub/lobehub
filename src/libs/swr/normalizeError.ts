/**
 * Canonical async-error shape shared by the whole data layer.
 *
 * The read/write conventions used to throw the SWR `error` away (hooks only
 * registered `onSuccess`, call sites only destructured `{ data, isLoading }`),
 * so a failed fetch had no way to reach the UI and silently degraded into a
 * permanent skeleton / a fake empty / a confident `$0`. This module gives every
 * surface one normalized error to branch on — see `AsyncBoundary` / `AsyncError`
 * for the UI side.
 */
export interface NormalizedAsyncError {
  /** Machine code when the backend supplies one (TRPC `code`, app error code). */
  code?: string;
  /** Raw message from the error, used as a fallback when no status copy exists. */
  rawMessage?: string;
  /**
   * Whether retrying the same request could plausibly succeed. `false` for auth
   * / permission failures (401 / 403) and anything the backend explicitly marks
   * non-retryable (`meta.shouldRetry === false`, mirroring the SWR retry gate).
   */
  retryable: boolean;
  /** HTTP-ish status when we can recover one, for status-specific copy. */
  status?: number;
}

const NON_RETRYABLE_STATUS = new Set([401, 403]);

/**
 * Best-effort extraction of an HTTP status from the heterogeneous error shapes
 * that reach SWR: TRPC client errors (`data.httpStatus`), fetch `Response`
 * rejections (`status` / `response.status`), and plain objects.
 */
const extractStatus = (error: any): number | undefined => {
  const status =
    error?.data?.httpStatus ??
    error?.data?.status ??
    error?.status ??
    error?.response?.status ??
    error?.cause?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Fold any thrown value into a {@link NormalizedAsyncError}. Pure and
 * i18n-free — the `AsyncError` component maps `status` → localized copy — so it
 * stays trivially testable and reusable in non-React code (retry policies,
 * logging).
 */
export const normalizeAsyncError = (error: unknown): NormalizedAsyncError => {
  if (!error) return { retryable: true };

  const err = error as any;
  const status = extractStatus(err);
  const code: string | undefined = err?.data?.code ?? err?.code;
  const rawMessage: string | undefined = typeof err?.message === 'string' ? err.message : undefined;

  // Honor the same non-retryable marker the SWR retry loop checks, and never
  // invite a retry on an auth / permission wall.
  const explicitlyNonRetryable = err?.meta?.shouldRetry === false;
  const retryable =
    !explicitlyNonRetryable && !(typeof status === 'number' && NON_RETRYABLE_STATUS.has(status));

  return { code, rawMessage, retryable, status };
};

/**
 * Statuses an *automatic* backoff must not retry.
 *
 * Deliberately wider than {@link NormalizedAsyncError.retryable}, because the
 * two answer different questions. `retryable` asks "could the user usefully
 * press Retry?"; this asks "should a timer fire the same request again on its
 * own?". `429` splits them: pressing Retry once the window has passed works
 * fine, but an automatic backoff at 1s/2s/4s/8s/16s lands every attempt inside
 * the very window that produced the `429` — turning one failed load into six
 * requests that keep the bucket empty and make the error self-sustaining. So a
 * `429` stays user-retryable while auto-retry stands down.
 */
const NON_AUTO_RETRYABLE_STATUS = new Set([401, 403, 429]);

/**
 * Whether SWR's error-retry loop should keep retrying this failure on a timer.
 */
export const isAutoRetryable = (error: unknown): boolean => {
  const err = error as any;
  if (err?.meta?.shouldRetry === false) return false;

  const status = extractStatus(err);
  return !(typeof status === 'number' && NON_AUTO_RETRYABLE_STATUS.has(status));
};
