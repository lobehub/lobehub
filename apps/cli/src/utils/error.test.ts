import { describe, expect, it } from 'vitest';

import { formatError, isTransientNetworkError } from './error';

describe('error utilities', () => {
  it('formats unique messages and codes from the cause chain', () => {
    const cause = Object.assign(new Error('Could not connect'), { code: 'ConnectionRefused' });
    const error = new Error('fetch failed', { cause });

    expect(formatError(error)).toBe('fetch failed: Could not connect: ConnectionRefused');
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
