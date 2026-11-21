import { describe, expect, it } from 'vitest';

import {
  generateWebhookToken,
  genericWebhookEndpoint,
  presentedToken,
  tokenMatches,
} from './token';

describe('generic webhook tokens', () => {
  it('generates URL-safe tokens with 256 bits of randomness', () => {
    const token = generateWebhookToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(generateWebhookToken()).not.toBe(token);
  });

  it('reads the key from a Bearer header only', () => {
    expect(presentedToken({ headers: new Headers({ authorization: 'Bearer from-header' }) })).toBe(
      'from-header',
    );
    expect(presentedToken({ headers: new Headers() })).toBeUndefined();
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

  it('builds a URL that holds no key', () => {
    expect(genericWebhookEndpoint('0d6f')).toMatch(/\/api\/webhooks\/inbound\/0d6f$/);
  });
});
