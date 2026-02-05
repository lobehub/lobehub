import { describe, expect, it } from 'vitest';

import { sanitizeError } from './sanitizeError';

describe('sanitizeError', () => {
  it('should remove sensitive request headers', () => {
    const errorWithHeaders = {
      message: 'API Error',
      code: 401,
      request: {
        headers: {
          authorization: 'Bearer sk-1234567890',
          'content-type': 'application/json',
          'ocp-apim-subscription-key': 'azure-key-123',
        },
        url: 'https://api.example.com',
      },
    };

    const sanitized = sanitizeError(errorWithHeaders);

    expect(sanitized).toEqual({
      message: 'API Error',
      code: 401,
    });
    expect(sanitized.request).toBeUndefined();
  });

  it('should remove sensitive fields at any level', () => {
    const errorWithNestedSensitive = {
      message: 'Error',
      data: {
        config: {
          apikey: 'secret-key',
          headers: {
            authorization: 'Bearer token',
          },
        },
        response: {
          status: 401,
          data: 'Unauthorized',
        },
      },
    };

    const sanitized = sanitizeError(errorWithNestedSensitive);

    expect(sanitized).toEqual({
      message: 'Error',
      data: {
        response: {
          status: 401,
          data: 'Unauthorized',
        },
      },
    });
    expect(sanitized.data.config).toBeUndefined();
  });

  it('should handle primitive values', () => {
    expect(sanitizeError('string')).toBe('string');
    expect(sanitizeError(123)).toBe(123);
    expect(sanitizeError(true)).toBe(true);
    expect(sanitizeError(null)).toBe(null);
    expect(sanitizeError(undefined)).toBe(undefined);
  });

  it('should handle arrays', () => {
    const errorArray = [
      { message: 'Error 1', apikey: 'secret' },
      { message: 'Error 2', status: 500 },
    ];

    const sanitized = sanitizeError(errorArray);

    expect(sanitized).toEqual([{ message: 'Error 1' }, { message: 'Error 2', status: 500 }]);
  });

  it('should be case insensitive for sensitive field detection', () => {
    const errorWithMixedCase = {
      message: 'Error',
      Authorization: 'Bearer token',
      'API-KEY': 'secret',
      Headers: { token: 'secret' },
    };

    const sanitized = sanitizeError(errorWithMixedCase);

    expect(sanitized).toEqual({
      message: 'Error',
    });
  });

  it('should preserve safe nested structures', () => {
    const errorWithSafeNested = {
      message: 'Error occurred',
      status: 401,
      details: {
        code: 'UNAUTHORIZED',
        timestamp: '2024-01-01T00:00:00Z',
        path: '/api/chat',
      },
    };

    const sanitized = sanitizeError(errorWithSafeNested);

    expect(sanitized).toEqual(errorWithSafeNested);
  });
});