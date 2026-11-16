import { describe, expect, it } from 'vitest';

import { ConnectorOAuthError } from '@/utils/connectorOAuth';

import { getSaveErrorToast } from './saveErrorToast';

const trpcError = (code: string, httpStatus: number, message: string) =>
  Object.assign(new Error(message), { data: { code, httpStatus } });

describe('getSaveErrorToast', () => {
  it('shows the authorization server reason for an OAuth BAD_REQUEST', () => {
    // Regression: a rejected dynamic registration collapsed into the generic
    // "Authorization failed" toast, hiding what the user had to fix.
    const error = trpcError(
      'BAD_REQUEST',
      400,
      'Dynamic client registration failed: unsupported token_endpoint_auth_method',
    );

    expect(getSaveErrorToast(error, true)).toEqual({
      description: 'Dynamic client registration failed: unsupported token_endpoint_auth_method',
      titleKey: 'dev.oauthError.failed',
    });
  });

  it('keeps internal OAuth errors generic', () => {
    const error = trpcError('INTERNAL_SERVER_ERROR', 500, 'connection reset');

    expect(getSaveErrorToast(error, true)).toEqual({
      description: undefined,
      titleKey: 'dev.oauthError.failed',
    });
  });

  it('maps popup outcomes to their dedicated messages', () => {
    expect(getSaveErrorToast(new ConnectorOAuthError('dismissed'), true)).toEqual({
      titleKey: 'dev.oauthError.dismissed',
    });
  });

  it('reports a permission failure before anything else', () => {
    expect(getSaveErrorToast(trpcError('FORBIDDEN', 403, 'nope'), true)).toEqual({
      titleKey: 'dev.permissionDenied',
    });
  });

  it.each([false, true])('shows why the MCP address was blocked (OAuth: %s)', (isOAuth) => {
    // Regression: the refusal surfaced as "you are not allowed to modify this
    // connector" with no reason, hiding the address policy and its switches.
    const reason = 'The MCP server address resolves to a private IP address …';
    const error = Object.assign(new Error(reason), {
      data: { code: 'BAD_REQUEST', errorData: { type: 'SSRF_BLOCKED' }, httpStatus: 400 },
    });

    expect(getSaveErrorToast(error, isOAuth)).toEqual({
      description: reason,
      titleKey: 'mcpInstall.errorTypes.SSRF_BLOCKED',
    });
  });

  it('uses the plain install error outside the OAuth path', () => {
    expect(getSaveErrorToast(trpcError('BAD_REQUEST', 400, 'bad url'), false)).toEqual({
      titleKey: 'dev.saveError',
    });
  });
});
