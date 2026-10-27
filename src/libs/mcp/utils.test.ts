import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { getMCPErrorLogMetadata } from './utils';

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
