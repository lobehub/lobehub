import { describe, expect, it } from 'vitest';

import { normalizeAsyncError } from './normalizeError';

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
