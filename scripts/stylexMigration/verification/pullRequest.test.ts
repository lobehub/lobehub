import { describe, expect, it } from 'vitest';

import { validatePullRequest } from './pullRequest';

const response = () => ({
  base: { ref: 'canary', repo: { full_name: 'lobehub/lobehub' }, sha: 'a'.repeat(40) },
  head: { repo: { full_name: 'contributor/lobehub' }, sha: 'b'.repeat(40) },
  number: 21447,
});

describe('PR revision identity', () => {
  it('keeps a fork head separate from the target repository', () => {
    expect(validatePullRequest(response(), 'lobehub/lobehub', 21447)).toMatchObject({
      baseRef: 'canary',
      headRepository: 'contributor/lobehub',
    });
  });
  it('rejects an identically numbered PR from a different target repository', () => {
    expect(() => validatePullRequest(response(), 'other/lobehub', 21447)).toThrow(
      'PR_REPOSITORY_IDENTITY_MISMATCH',
    );
    expect(() => validatePullRequest(response(), 'lobehub/lobehub', 1)).toThrow(
      'PR_REPOSITORY_IDENTITY_MISMATCH',
    );
  });
  it('rejects missing forks and malformed SHAs', () => {
    expect(() =>
      validatePullRequest(
        { ...response(), head: { repo: null, sha: 'b'.repeat(40) } },
        'lobehub/lobehub',
        21447,
      ),
    ).toThrow('PR_HEAD_REPOSITORY_UNAVAILABLE');
    expect(() =>
      validatePullRequest(
        { ...response(), base: { ...response().base, sha: '--help' } },
        'lobehub/lobehub',
        21447,
      ),
    ).toThrow();
  });
});
