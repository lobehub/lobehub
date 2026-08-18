import { describe, expect, it } from 'vitest';

import { isAutoRetryable, normalizeAsyncError } from './normalizeError';

describe('normalizeAsyncError', () => {
  it('treats a missing error as retryable with no status', () => {
    expect(normalizeAsyncError(undefined)).toEqual({ retryable: true });
    expect(normalizeAsyncError(null)).toEqual({ retryable: true });
  });

  it('recovers an HTTP status from a TRPC client error shape', () => {
    const err = { data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 }, message: 'boom' };
    const result = normalizeAsyncError(err);
    expect(result.status).toBe(500);
    expect(result.code).toBe('INTERNAL_SERVER_ERROR');
    expect(result.rawMessage).toBe('boom');
    expect(result.retryable).toBe(true);
  });

  it('recovers a status from fetch Response-like shapes', () => {
    expect(normalizeAsyncError({ status: 503 }).status).toBe(503);
    expect(normalizeAsyncError({ response: { status: 502 } }).status).toBe(502);
    expect(normalizeAsyncError({ cause: { status: 504 } }).status).toBe(504);
  });

  it('marks auth / permission failures as non-retryable', () => {
    expect(normalizeAsyncError({ data: { httpStatus: 401 } }).retryable).toBe(false);
    expect(normalizeAsyncError({ status: 403 }).retryable).toBe(false);
  });

  it('honors an explicit non-retryable marker regardless of status', () => {
    expect(normalizeAsyncError({ meta: { shouldRetry: false }, status: 500 }).retryable).toBe(
      false,
    );
  });

  it('keeps 5xx and other transient failures retryable', () => {
    expect(normalizeAsyncError({ status: 500 }).retryable).toBe(true);
    expect(normalizeAsyncError({ status: 408 }).retryable).toBe(true);
  });
});

describe('isAutoRetryable', () => {
  /**
   * The skill store regression: an upstream 429 used to be retried on a
   * 1s/2s/4s/8s/16s backoff, so one failed open became six requests — all of
   * them landing inside the very window that caused the 429.
   */
  it('stands down on a rate limit so the backoff cannot refill the window', () => {
    expect(isAutoRetryable({ data: { httpStatus: 429 } })).toBe(false);
    expect(isAutoRetryable({ status: 429 })).toBe(false);
  });

  it('keeps a rate limit user-retryable even though auto-retry stands down', () => {
    // Different questions: a manual Retry a minute later works fine.
    expect(normalizeAsyncError({ status: 429 }).retryable).toBe(true);
  });

  it('does not auto-retry auth / permission walls', () => {
    expect(isAutoRetryable({ data: { httpStatus: 401 } })).toBe(false);
    expect(isAutoRetryable({ status: 403 })).toBe(false);
  });

  it('honors an explicit non-retryable marker regardless of status', () => {
    expect(isAutoRetryable({ meta: { shouldRetry: false }, status: 500 })).toBe(false);
  });

  it('still auto-retries transient failures', () => {
    expect(isAutoRetryable({ status: 500 })).toBe(true);
    expect(isAutoRetryable({ status: 408 })).toBe(true);
    expect(isAutoRetryable(new Error('network down'))).toBe(true);
    expect(isAutoRetryable(undefined)).toBe(true);
  });
});
