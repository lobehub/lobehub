import { describe, expect, it } from 'vitest';

import { ConnectorDataError } from './errors';

describe('ConnectorDataError', () => {
  /** @example expect(error.message).toBe('upstream response body with status=401'); */
  it('retains the original connector failure message and cause object', () => {
    // ROOT CAUSE:
    //
    // ConnectorDataError previously retained structured metadata but discarded the upstream error
    // object, so Error.cause could not expose its response, stack, or SDK-specific fields.
    //
    // We fixed this by passing the original value directly to the native Error cause option.
    const cause = new Error('raw upstream failure');
    const input = {
      cause,
      code: 'github_request_failed',
      message: 'upstream response body with status=401',
      operation: 'listRepositories',
      provider: 'github',
      retryable: false,
    } as const;
    const error = new ConnectorDataError(input);

    /** @example expect(error).toBeInstanceOf(Error); */
    expect(error).toBeInstanceOf(Error);
    /** @example expect(error).toMatchObject({ message: input.message }); */
    expect(error).toMatchObject({
      code: 'github_request_failed',
      message: input.message,
      name: 'ConnectorDataError',
      operation: 'listRepositories',
      provider: 'github',
      retryable: false,
    });
    /** @example expect(error.cause).toBe(cause); */
    expect(error.cause).toBe(cause);
  });
});
