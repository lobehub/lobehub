import { describe, expect, it } from 'vitest';

import { parseChangeRequestUrl } from '../changeRequestUrl';

describe('parseChangeRequestUrl', () => {
  it('reads a GitHub pull request URL, including a tab under it', () => {
    const expected = {
      number: 20171,
      provider: 'github',
      repoFullName: 'lobehub/lobehub',
      url: 'https://github.com/lobehub/lobehub/pull/20171',
    };
    expect(parseChangeRequestUrl('https://github.com/lobehub/lobehub/pull/20171')).toEqual(
      expected,
    );
    expect(
      parseChangeRequestUrl(' https://github.com/lobehub/lobehub/pull/20171/files?w=1#diff '),
    ).toEqual(expected);
  });

  it('rejects anything that does not name a pull request', () => {
    for (const value of [
      'not a url',
      'http://github.com/lobehub/lobehub/pull/1',
      'https://gitlab.com/lobehub/lobehub/pull/1',
      'https://github.com.evil.dev/lobehub/lobehub/pull/1',
      'https://github.com/lobehub/lobehub/issues/1',
      'https://github.com/lobehub/lobehub/pull/0',
      'https://github.com/lobehub/lobehub/pull/abc',
    ])
      expect(parseChangeRequestUrl(value)).toBeNull();
  });
});
