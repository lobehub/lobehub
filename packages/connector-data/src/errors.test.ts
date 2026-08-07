import { describe, expect, it } from 'vitest';

import { ConnectorDataError } from './errors';

describe('ConnectorDataError', () => {
  it('exposes a sanitized connector failure contract', () => {
    const unsafeInput = {
      code: 'github_request_failed',
      message: 'upstream response body with token=secret',
      operation: 'listRepositories',
      provider: 'github',
      retryable: false,
    } as const;
    const error = new ConnectorDataError(unsafeInput);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      code: 'github_request_failed',
      message: 'github listRepositories failed',
      name: 'ConnectorDataError',
      operation: 'listRepositories',
      provider: 'github',
      retryable: false,
    });
    expect(error.message).not.toContain(unsafeInput.message);
  });
});
