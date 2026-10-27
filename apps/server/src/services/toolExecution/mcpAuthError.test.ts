import { SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { isMcpAuthorizationError } from './mcpAuthError';

describe('MCP authorization error brands', () => {
  it.each([
    new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'credentials rejected', {
      status: 401,
    }),
    new UnauthorizedError(),
  ])('recognizes SDK authorization failures through causes: %s', (cause) => {
    expect(isMcpAuthorizationError(new Error('tool execution failed', { cause }))).toBe(true);
  });

  it('does not treat an arbitrary numeric code as an HTTP status', () => {
    expect(
      isMcpAuthorizationError(Object.assign(new Error('application failure'), { code: 401 })),
    ).toBe(false);
    expect(
      isMcpAuthorizationError(
        new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'upstream failed', { status: 500 }),
      ),
    ).toBe(false);
  });

  it('bounds cyclic causes and preserves already classified authorization errors', () => {
    const error = new Error('application failure');
    error.cause = error;
    expect(isMcpAuthorizationError(error)).toBe(false);
    expect(isMcpAuthorizationError({ data: { type: 'AUTHORIZATION_ERROR' } })).toBe(true);
  });
});
