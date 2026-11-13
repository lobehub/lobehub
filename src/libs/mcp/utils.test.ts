import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { createMCPError } from './types';
import { getMCPConnectionErrorType, getMCPErrorLogMetadata } from './utils';

describe('getMCPConnectionErrorType', () => {
  it.each(['AUTHORIZATION_ERROR', 'INITIALIZATION_TIMEOUT', 'CONNECTION_FAILED'] as const)(
    'classifies normalized %s',
    (type) => {
      expect(getMCPConnectionErrorType(createMCPError(type, 'MCP failed'))).toBe(type);
    },
  );
  it.each([new Error('failure'), { data: { type: 'FORBIDDEN' } }, { code: 401 }, null])(
    'does not classify unrelated errors',
    (error) => {
      expect(getMCPConnectionErrorType(error)).toBeUndefined();
    },
  );
});

describe('getMCPErrorLogMetadata', () => {
  it('keeps the HTTP status of an SDK v2 HTTP error, which is not in its code', () => {
    const error = new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'untrusted body', {
      status: 401,
    });

    expect(getMCPErrorLogMetadata(error)).toEqual({ name: 'Error', status: 401 });
  });

  it('keeps a numeric JSON-RPC code and drops the message', () => {
    const error = Object.assign(new Error('untrusted remote text'), { code: -32_602 });

    expect(getMCPErrorLogMetadata(error)).toEqual({ code: -32_602, name: 'Error' });
  });
});
