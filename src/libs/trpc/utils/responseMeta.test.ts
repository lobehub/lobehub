import { AUTH_REQUIRED_HEADER, TRPC_ERROR_CODE_UNAUTHORIZED } from '@lobechat/desktop-bridge';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createResponseMeta } from './responseMeta';

describe('createResponseMeta', () => {
  it('should return undefined headers when no errors and no resHeaders', () => {
    const result = createResponseMeta({ ctx: undefined, errors: [] });
    expect(result.headers).toBeUndefined();
  });

  it('should forward resHeaders from context', () => {
    const resHeaders = new Headers({ 'X-Custom': 'value' });
    const result = createResponseMeta({
      ctx: { resHeaders },
      errors: [],
    });

    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.headers?.get('X-Custom')).toBe('value');
  });

  it('should set AUTH_REQUIRED_HEADER header for UNAUTHORIZED error', () => {
    const error = new TRPCError({ code: TRPC_ERROR_CODE_UNAUTHORIZED });
    const result = createResponseMeta({
      ctx: undefined,
      errors: [error],
    });

    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.headers?.get(AUTH_REQUIRED_HEADER)).toBe('true');
  });

  it('should set AUTH_REQUIRED_HEADER and preserve resHeaders for UNAUTHORIZED error', () => {
    const resHeaders = new Headers({ 'X-Custom': 'value' });
    const error = new TRPCError({ code: TRPC_ERROR_CODE_UNAUTHORIZED });
    const result = createResponseMeta({
      ctx: { resHeaders },
      errors: [error],
    });

    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.headers?.get(AUTH_REQUIRED_HEADER)).toBe('true');
    expect(result.headers?.get('X-Custom')).toBe('value');
  });

  it('should NOT set AUTH_REQUIRED_HEADER for non-UNAUTHORIZED errors', () => {
    const error = new TRPCError({ code: 'BAD_REQUEST' });
    const result = createResponseMeta({
      ctx: undefined,
      errors: [error],
    });

    expect(result.headers).toBeUndefined();
  });

  it('should handle context without resHeaders property', () => {
    const error = new TRPCError({ code: TRPC_ERROR_CODE_UNAUTHORIZED });
    const result = createResponseMeta({
      ctx: { userId: 'test-user' },
      errors: [error],
    });

    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.headers?.get(AUTH_REQUIRED_HEADER)).toBe('true');
  });

  it('should handle multiple errors where one is UNAUTHORIZED', () => {
    const errors = [
      new TRPCError({ code: 'BAD_REQUEST' }),
      new TRPCError({ code: TRPC_ERROR_CODE_UNAUTHORIZED }),
    ];
    const result = createResponseMeta({
      ctx: undefined,
      errors,
    });

    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.headers?.get(AUTH_REQUIRED_HEADER)).toBe('true');
  });
});
