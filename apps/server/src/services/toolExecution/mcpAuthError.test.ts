import { SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createMCPError } from '@/libs/mcp/types';

import { isMcpAuthorizationError } from './mcpAuthError';

describe('MCP authorization error brands', () => {
  it('recognizes normalized authorization through a forbidden connector response', () => {
    const cause = createMCPError('AUTHORIZATION_ERROR', 'Reconnect the MCP');
    expect(isMcpAuthorizationError(new TRPCError({ code: 'FORBIDDEN', cause }))).toBe(true);
    expect(isMcpAuthorizationError(new TRPCError({ code: 'UNAUTHORIZED' }))).toBe(false);
    expect(isMcpAuthorizationError(new TRPCError({ code: 'FORBIDDEN' }))).toBe(false);
  });
  it.each([
    new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'credentials rejected', {
      status: 401,
    }),
    new UnauthorizedError(),
    new SdkHttpError(SdkErrorCode.ClientHttpForbidden, 'credentials rejected', { status: 403 }),
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
