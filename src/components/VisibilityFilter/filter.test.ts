import { describe, expect, it } from 'vitest';

import { matchesVisibilityFilter } from './filter';

describe('matchesVisibilityFilter', () => {
  it('keeps every row under all', () => {
    expect(matchesVisibilityFilter(true, 'all')).toBe(true);
    expect(matchesVisibilityFilter(false, 'all')).toBe(true);
  });

  it('keeps only private rows under private', () => {
    expect(matchesVisibilityFilter(true, 'private')).toBe(true);
    expect(matchesVisibilityFilter(false, 'private')).toBe(false);
  });

  it('keeps only shared rows under workspace', () => {
    expect(matchesVisibilityFilter(false, 'workspace')).toBe(true);
    expect(matchesVisibilityFilter(true, 'workspace')).toBe(false);
  });
});
