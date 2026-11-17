import { describe, expect, it } from 'vitest';

import { describeGitHubError } from '../errorLog';

describe('describeGitHubError', () => {
  it('keeps the status and message but never the request body with secrets', () => {
    const error = Object.assign(new Error('Bad credentials'), {
      request: { body: 'client_secret=shh-secret&refresh_token=ghr_secret' },
      status: 401,
    });

    expect(describeGitHubError(error)).toBe('401 Bad credentials');
    expect(describeGitHubError(error)).not.toContain('secret');
  });
});
