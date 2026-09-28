import { describe, expect, it } from 'vitest';

import { acceptanceListEmptyVariant, normalizeAcceptanceListFilter } from './acceptanceListFilter';

describe('normalizeAcceptanceListFilter', () => {
  it('falls back to the active filter for malformed persisted values', () => {
    expect(normalizeAcceptanceListFilter('unknown')).toBe('active');
    expect(normalizeAcceptanceListFilter(null)).toBe('active');
  });
});

describe('acceptanceListEmptyVariant', () => {
  it('shows the first-run empty state when the user owns nothing, even under the active filter', () => {
    expect(
      acceptanceListEmptyVariant({ allListEmpty: true, filter: 'active', searching: false }),
    ).toBe('firstRun');
    expect(
      acceptanceListEmptyVariant({ allListEmpty: true, filter: 'active', searching: true }),
    ).toBe('firstRun');
  });

  it('keeps the filtered escape hatch when other acceptances exist or the probe has not resolved', () => {
    expect(
      acceptanceListEmptyVariant({ allListEmpty: false, filter: 'active', searching: false }),
    ).toBe('filtered');
    expect(acceptanceListEmptyVariant({ filter: 'active', searching: false })).toBe('filtered');
    expect(
      acceptanceListEmptyVariant({ allListEmpty: false, filter: 'all', searching: true }),
    ).toBe('filtered');
  });

  it('reads an unfiltered zero-result browse as first run', () => {
    expect(
      acceptanceListEmptyVariant({ allListEmpty: false, filter: 'all', searching: false }),
    ).toBe('firstRun');
  });
});
