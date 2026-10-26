import { describe, expect, it } from 'vitest';

import { isHomePath } from './HomeInboxRedirect';

describe('isHomePath', () => {
  it.each([
    ['/', null, true],
    ['/team', 'team', true],
    ['/team/', 'team', true],
    ['/team', null, false],
    ['/agent/inbox', null, false],
    ['/team/agent/x', 'team', false],
  ])('%s (slug %s) → %s', (pathname, slug, expected) => {
    expect(isHomePath(pathname, slug)).toBe(expected);
  });
});
