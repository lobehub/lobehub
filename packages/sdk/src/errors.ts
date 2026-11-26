import type { ApiErrorCode } from './generated/types.gen';

/** One failing field of a `validation_error`, or route-specific detail. */
export type LobeHubErrorDetails = unknown;

const REQUEST_ID_HEADER = 'X-Request-Id';

type ErrorBody = Record<string, unknown>;

const isRecord = (value: unknown): value is ErrorBody =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * An error answer from the API (any non-2xx status).
 *
 * It carries the fields of the `ApiError` body (`code`, `message`, `details`,
 * `requestId`, …), so code that read `error.code` from the plain body keeps
 * working. The OpenResponses route (`POST /responses`) answers
 * `{ error: { type, message, code } }`; its `type` / `code` land in `code`.
 */
export class LobeHubAPIError extends Error {
  /** Stable machine-readable code (see `ApiErrorCode`); branch on this, not on `message`. */
  readonly code: ApiErrorCode | (string & {});
  /** Validation failures list `{ path, message }` per field. */
  readonly details?: LobeHubErrorDetails;
  /** Response headers, e.g. `Retry-After` on a 429. */
  readonly headers?: Headers;
  /** The parsed (or raw text) response body. */
  readonly body: unknown;
  /** Quote it when reporting an issue; also sent as the `X-Request-Id` header. */
  readonly requestId?: string;
  readonly status: number;
  /** `ApiError` body fields, kept for code written against the plain body. */
  readonly success = false as const;
  readonly timestamp?: string;
  /** @deprecated alias of `message` from the `ApiError` body. */
  readonly error?: unknown;

  constructor(status: number, body: unknown, headers?: Headers) {
    const record = isRecord(body) ? body : {};
    const nested = isRecord(record.error) ? record.error : undefined;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (typeof nested?.message === 'string' && nested.message) ||
      (typeof body === 'string' && body) ||
      `Request failed with status ${status}`;

    super(message);
    this.name = 'LobeHubAPIError';
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.code =
      (typeof record.code === 'string' && record.code) ||
      (typeof nested?.code === 'string' && nested.code) ||
      (typeof nested?.type === 'string' && nested.type) ||
      `http_${status}`;
    this.details = record.details;
    this.requestId =
      (typeof record.requestId === 'string' && record.requestId) ||
      headers?.get(REQUEST_ID_HEADER) ||
      undefined;
    this.timestamp = typeof record.timestamp === 'string' ? record.timestamp : undefined;
    this.error = record.error;
  }
}

/** The request never got an HTTP answer: DNS, TLS, connection reset, … */
export class LobeHubConnectionError extends Error {
  constructor(message = 'Connection error', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LobeHubConnectionError';
  }
}

/** No response headers arrived within `timeout` milliseconds. */
export class LobeHubTimeoutError extends LobeHubConnectionError {
  readonly timeout: number;

  constructor(timeout: number) {
    super(`Request timed out after ${timeout}ms`);
    this.name = 'LobeHubTimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Turn an error body the generated client rejected with into a
 * `LobeHubAPIError`. Transport failures are already `LobeHubConnectionError`s
 * (see `transport.ts`), and anything else — a caller abort, a request that
 * could not be built — passes through untouched.
 */
export const toLobeHubError = (error: unknown, response?: Response): unknown =>
  response && !response.ok && !(error instanceof Error)
    ? new LobeHubAPIError(response.status, error, response.headers)
    : error;
