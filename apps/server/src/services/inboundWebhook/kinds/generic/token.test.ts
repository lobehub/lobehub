import { describe, expect, it } from 'vitest';

import { generateWebhookToken, presentedToken, tokenMatches } from './token';

describe('generic webhook tokens', () => {
  it('generates URL-safe tokens with 256 bits of randomness', () => {
    const token = generateWebhookToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(generateWebhookToken()).not.toBe(token);
  });

  it('prefers the path token, then a Bearer header', () => {
    const headers = new Headers({ authorization: 'Bearer from-header' });
    expect(presentedToken({ headers, pathToken: 'from-path' })).toBe('from-path');
    expect(presentedToken({ headers })).toBe('from-header');
    expect(
      presentedToken({ headers: new Headers({ authorization: 'Basic abc' }) }),
    ).toBeUndefined();
  });

  it('matches only the exact secret', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches('ab', 'abc')).toBe(false);
    expect(tokenMatches(undefined, 'abc')).toBe(false);
    expect(tokenMatches('abc', null)).toBe(false);
  });
});
