import { describe, expect, it } from 'vitest';

import { formatError, isTransientNetworkError } from './error';

describe('error utilities', () => {
  it('formats unique messages and codes from the cause chain', () => {
    const cause = Object.assign(new Error('Could not connect'), { code: 'ConnectionRefused' });
    const error = new Error('fetch failed', { cause });

    expect(formatError(error)).toBe('fetch failed: Could not connect: ConnectionRefused');
  });

  it('prints the page character-limit refusal with its numbers', () => {
    const message =
      'This document would have 120,500 characters, over the 100,000-character limit per document on your plan.';
    const error = Object.assign(new Error(message), {
      data: {
        code: 'BAD_REQUEST',
        errorData: { actual: 120_500, code: 'DocumentCharLimitExceeded', limit: 100_000 },
      },
    });

    expect(formatError(error)).toBe(message);
  });

  it('handles error-like objects and circular cause chains', () => {
    const error: { cause?: unknown; code: string; message: string; name: string } = {
      code: 'ECONNRESET',
      message: 'socket closed',
      name: 'NetworkError',
    };
    error.cause = error;

    expect(formatError(error)).toBe('socket closed: ECONNRESET');
  });

  it.each([
    new TypeError('fetch failed'),
    new Error('request failed', { cause: { code: 'ECONNRESET' } }),
    new Error('request failed', { cause: { code: 'ConnectionRefused' } }),
  ])('recognizes transient fetch failures through their cause chain', (error) => {
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it('does not classify application errors as transient network failures', () => {
    expect(isTransientNetworkError(new Error('Unauthorized'))).toBe(false);
  });
});
