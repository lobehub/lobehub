import { describe, expect, it } from 'vitest';

import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
  WORKSPACE_SLUG_PATTERN,
} from './workspace';

describe('workspace slug format', () => {
  it.each(['foo', 'foo-bar', 'a1', 'admin', '1-2-3'])('accepts %s', (slug) => {
    expect(isWorkspaceSlugFormatValid(slug)).toBe(true);
  });

  it.each(['-foo', 'foo-', 'Foo', 'foo_bar', 'foo bar', 'foo.bar', '', '中文', '@foo'])(
    'rejects %s',
    (slug) => {
      expect(isWorkspaceSlugFormatValid(slug)).toBe(false);
    },
  );

  // Length is enforced by the callers' zod schema, not by the pattern.
  it('does not enforce length', () => {
    expect(isWorkspaceSlugFormatValid('a')).toBe(true);
    expect(isWorkspaceSlugFormatValid('a'.repeat(WORKSPACE_SLUG_MAX + 1))).toBe(true);
    expect(WORKSPACE_SLUG_MIN).toBeLessThan(WORKSPACE_SLUG_MAX);
    expect(WORKSPACE_SLUG_PATTERN.test('a'.repeat(WORKSPACE_SLUG_MIN))).toBe(true);
  });
});
