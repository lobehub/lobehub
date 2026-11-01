import { describe, expect, it } from 'vitest';

import { hasGmailReadPermission } from './permissions';

/** @example Gmail scope variants are classified before Understanding starts. */
describe('hasGmailReadPermission', () => {
  /** @example Read-only, modify, and full mailbox scopes all permit message collection. */
  it.each([
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://mail.google.com/',
  ])('accepts %s', (scope) => {
    expect(hasGmailReadPermission([scope])).toBe(true);
  });

  /** @example Identity-only and similarly named scopes cannot read Gmail messages. */
  it('rejects scopes without mailbox read access', () => {
    expect(
      hasGmailReadPermission([
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://example.com/gmail.readonly',
      ]),
    ).toBe(false);
  });
});
