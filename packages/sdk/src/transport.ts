import { LobeHubConnectionError, LobeHubTimeoutError } from './errors';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

// Generous on purpose: a non-streaming `responses.create` answers only once the agent run ends.
export const DEFAULT_TIMEOUT = 600_000;
export const DEFAULT_MAX_RETRIES = 2;

/** Safe to resend as-is: the server applies them at most once by definition. */
const IDEMPOTENT_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PUT']);
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const INITIAL_RETRY_DELAY = 500;
const MAX_RETRY_DELAY = 8000;
/** A server asking for a longer pause than this gets its answer returned instead. */
const MAX_RETRY_AFTER = 60_000;

export interface TransportSettings {
  maxRetries: number;
  /**
   * The caller asked for the response body itself (`parseAs: 'stream'`), which
   * the server answers as `text/event-stream`. Its idempotency middleware keeps
   * no replay record for that media type, so a retry starts a second run
   * instead of replaying the first one: such requests never retry.
   */
  streaming?: boolean;
  timeout: number;
}

/**
 * Per-request settings, keyed by the `Request` the generated client built:
 * the request interceptor (which sees the call's options) records them, and
 * the fetch wrapper (which only sees the `Request`) reads them.
 */
export const requestSettings = new WeakMap<Request, TransportSettings>();

/** `Retry-After` as delay-seconds or an HTTP date, in milliseconds. */
export const parseRetryAfter = (value: string | null, now = Date.now()): number | undefined => {
  if (!value) return;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
};

/** Exponential backoff with ±25% jitter: ~0.5s, 1s, 2s, … capped at 8s. */
export const backoffDelay = (attempt: number, random = Math.random) =>
  Math.min(INITIAL_RETRY_DELAY * 2 ** attempt, MAX_RETRY_DELAY) * (0.75 + random() * 0.5);

const sleep = (ms: number, signal: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * Only resend what cannot double-apply: idempotent methods, or a POST the
 * server deduplicates through its `Idempotency-Key` (the server honors the key
 * on POST only, so a keyed PATCH is still not safe to resend).
 */
export const isRetryable = (request: Request) => {
  const method = request.method.toUpperCase();
  return (
    IDEMPOTENT_METHODS.has(method) ||
    (method === 'POST' && request.headers.has(IDEMPOTENCY_KEY_HEADER))
  );
};

/**
 * Whether an answer is worth another attempt. A keyed POST resent while the
 * first attempt is still running on the server (typical after a timeout or a
 * dropped connection) gets 409 `idempotency_conflict`; waiting and retrying
 * then yields the stored answer. A 422 with that code means a different
 * request reused the key, which a retry cannot fix.
 */
const shouldRetryStatus = async (request: Request, response: Response) => {
  if (RETRYABLE_STATUSES.has(response.status)) return true;
  if (response.status !== 409 || !request.headers.has(IDEMPOTENCY_KEY_HEADER)) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { code?: unknown } | undefined;
  return body?.code === 'idempotency_conflict';
};

/**
 * Wrap `fetch` with a per-attempt timeout (until the response headers arrive)
 * and retries with exponential backoff on 408/429/5xx, network failures and a
 * keyed POST's in-flight 409, honoring `Retry-After`. Network failures surface as `LobeHubConnectionError`
 * and timeouts as `LobeHubTimeoutError`; a caller abort stays an `AbortError`.
 */
export const createTransport = (
  baseFetch: typeof globalThis.fetch,
  defaults: TransportSettings,
  options: { random?: () => number } = {},
): typeof globalThis.fetch => {
  const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const settings = requestSettings.get(request) ?? defaults;
    const { maxRetries, timeout } = settings;
    // A streaming answer is never safe to resend, even keyed: the server
    // deduplicates JSON bodies only, so a retry would start another run.
    const retries = !settings.streaming && isRetryable(request) ? Math.max(0, maxRetries) : 0;
    const callerSignal = request.signal;

    for (let attempt = 0; ; attempt++) {
      // `abort` events do not replay, so a signal aborted before this attempt
      // (even before the request was sent) has to be checked directly.
      if (callerSignal.aborted) throw callerSignal.reason;
      const canRetry = attempt < retries;
      // The body can only be read once, so every attempt that may be followed
      // by another sends a clone.
      const current = canRetry ? request.clone() : request;
      const controller = new AbortController();
      // Forwarded for the life of the response, not just until its headers:
      // aborting must also stop a body that is still streaming. The listener
      // lives on this request's own signal, so it is collected with it.
      const forwardAbort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', forwardAbort, { once: true });
      let timedOut = false;
      const timer =
        timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeout)
          : undefined;

      let response: Response | undefined;
      let failure: Error | undefined;
      try {
        response = await baseFetch(current, { signal: controller.signal });
      } catch (error) {
        if (callerSignal.aborted) throw error;
        failure = timedOut
          ? new LobeHubTimeoutError(timeout)
          : new LobeHubConnectionError(error instanceof Error ? error.message : undefined, {
              cause: error,
            });
      } finally {
        // The timeout only bounds the wait for the headers.
        clearTimeout(timer);
      }

      if (response && !(canRetry && (await shouldRetryStatus(current, response)))) return response;
      if (!canRetry) throw failure;

      let delay = backoffDelay(attempt, options.random);
      if (response) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        if (retryAfter !== undefined) {
          if (retryAfter > MAX_RETRY_AFTER) return response;
          delay = retryAfter;
        }
        await response.body?.cancel().catch(() => {});
      }
      // This attempt is discarded: stop forwarding aborts to it.
      callerSignal.removeEventListener('abort', forwardAbort);
      await sleep(delay, callerSignal);
    }
  };

  return transport as typeof globalThis.fetch;
};
