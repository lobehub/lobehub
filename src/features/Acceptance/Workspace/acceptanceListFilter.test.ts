import { describe, expect, it } from 'vitest';

import { normalizeAcceptanceListFilter } from './acceptanceListFilter';

describe('normalizeAcceptanceListFilter', () => {
  it('falls back to the active filter for malformed persisted values', () => {
    expect(normalizeAcceptanceListFilter('unknown')).toBe('active');
    expect(normalizeAcceptanceListFilter(null)).toBe('active');
  });
});
