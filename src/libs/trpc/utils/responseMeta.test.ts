import {
  AUTH_REQUIRED_HEADER,
  MARKET_AUTH_REQUIRED_MESSAGE,
  TRPC_ERROR_CODE_UNAUTHORIZED,
} from '@lobechat/desktop-bridge';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createResponseMeta } from './responseMeta';

type TRPCErrorWithHttpStatus = TRPCError & { httpStatus?: number };

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

  it('should NOT set AUTH_REQUIRED_HEADER for Market OAuth UNAUTHORIZED errors', () => {
    const error = new TRPCError({
      code: TRPC_ERROR_CODE_UNAUTHORIZED,
      message: MARKET_AUTH_REQUIRED_MESSAGE,
    });
    const result = createResponseMeta({
      ctx: undefined,
      errors: [error],
    });

    expect(result.headers).toBeUndefined();
  });

  it('should NOT set AUTH_REQUIRED_HEADER for runtime provider auth errors', () => {
    const error = new TRPCError({
      code: TRPC_ERROR_CODE_UNAUTHORIZED,
      message: 'InvalidProviderAPIKey',
    }) as TRPCErrorWithHttpStatus;
    error.httpStatus = 401;

    const result = createResponseMeta({
      ctx: undefined,
      errors: [error],
    });

    expect(result.status).toBe(401);
    expect(result.headers?.get(AUTH_REQUIRED_HEADER)).toBeNull();
  });

  it('should preserve runtime custom HTTP status', () => {
    const error = new TRPCError({
      code: 'BAD_REQUEST',
      message: 'ProviderBizError',
    }) as TRPCErrorWithHttpStatus;
    error.httpStatus = 471;

    const result = createResponseMeta({
      ctx: undefined,
      errors: [error],
    });

    expect(result.status).toBe(471);
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
