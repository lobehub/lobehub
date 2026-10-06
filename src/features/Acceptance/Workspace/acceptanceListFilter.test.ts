import { describe, expect, it } from 'vitest';

import {
  acceptanceListEmptyVariant,
  isAcceptanceListFacetsNarrowed,
  normalizeAcceptanceListFacets,
  normalizeAcceptanceListFilter,
} from './acceptanceListFilter';

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

describe('normalizeAcceptanceListFacets', () => {
  it('keeps valid persisted facets, including the unfiled project', () => {
    expect(
      normalizeAcceptanceListFacets({ projectId: null, scope: 'participated', source: 'goal' }),
    ).toEqual({ projectId: null, scope: 'participated', source: 'goal' });
    expect(normalizeAcceptanceListFacets({ projectId: 'proj-1' }).projectId).toBe('proj-1');
  });

  it('falls back per field for malformed values', () => {
    expect(normalizeAcceptanceListFacets(null)).toEqual({
      projectId: undefined,
      scope: 'all',
      source: 'all',
    });
    expect(
      normalizeAcceptanceListFacets({ projectId: 3, scope: 'mine', source: 'document' }),
    ).toEqual({ projectId: undefined, scope: 'all', source: 'all' });
  });
});

describe('isAcceptanceListFacetsNarrowed', () => {
  it('treats any non-default facet as a narrowing', () => {
    expect(isAcceptanceListFacetsNarrowed({ scope: 'all', source: 'all' })).toBe(false);
    expect(isAcceptanceListFacetsNarrowed({ scope: 'participated', source: 'all' })).toBe(true);
    expect(isAcceptanceListFacetsNarrowed({ scope: 'all', source: 'topic' })).toBe(true);
    expect(isAcceptanceListFacetsNarrowed({ projectId: null, scope: 'all', source: 'all' })).toBe(
      true,
    );
  });

  it('keeps the filtered escape hatch for a facet-only narrowing', () => {
    expect(
      acceptanceListEmptyVariant({
        allListEmpty: false,
        facetsNarrowed: true,
        filter: 'all',
        searching: false,
      }),
    ).toBe('filtered');
  });
});
