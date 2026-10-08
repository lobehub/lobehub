import { describe, expect, it } from 'vitest';

import {
  acceptanceListEmptyVariant,
  acceptanceProjectScopeKey,
  effectiveAcceptanceListFacets,
  isAcceptanceListFacetsNarrowed,
  normalizeAcceptanceListFacets,
  normalizeAcceptanceListFilter,
  resetAcceptanceListFacets,
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
    ).toEqual({ projectId: null, projectScope: 'personal', scope: 'participated', source: 'goal' });
    expect(normalizeAcceptanceListFacets({ projectId: 'proj-1' }).projectId).toBe('proj-1');
  });

  it('falls back per field for malformed values', () => {
    expect(normalizeAcceptanceListFacets(null)).toEqual({
      projectId: undefined,
      projectScope: 'personal',
      scope: 'all',
      source: 'all',
    });
    expect(
      normalizeAcceptanceListFacets({ projectId: 3, scope: 'mine', source: 'document' }),
    ).toEqual({ projectId: undefined, projectScope: 'personal', scope: 'all', source: 'all' });
  });

  it('drops a project choice made in another workspace but keeps scope and source', () => {
    const stored = {
      projectId: 'proj-a',
      projectScope: 'ws-a',
      scope: 'participated',
      source: 'goal',
    };

    expect(normalizeAcceptanceListFacets(stored, 'ws-a').projectId).toBe('proj-a');
    expect(normalizeAcceptanceListFacets(stored, 'ws-b')).toEqual({
      projectId: undefined,
      projectScope: 'ws-b',
      scope: 'participated',
      source: 'goal',
    });
    expect(normalizeAcceptanceListFacets(stored, acceptanceProjectScopeKey(null)).projectId).toBe(
      undefined,
    );
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

describe('hosted project lists', () => {
  const stored = { projectId: 'standalone-pick', scope: 'all', source: 'all' } as const;

  it('applies the host project instead of the persisted standalone pick', () => {
    expect(effectiveAcceptanceListFacets(stored, 'host-project').projectId).toBe('host-project');
    expect(effectiveAcceptanceListFacets(stored).projectId).toBe('standalone-pick');
  });

  it('does not count the hidden persisted project as an active narrowing', () => {
    expect(isAcceptanceListFacetsNarrowed(stored, 'host-project')).toBe(false);
    expect(isAcceptanceListFacetsNarrowed({ ...stored, source: 'goal' }, 'host-project')).toBe(
      true,
    );
    expect(isAcceptanceListFacetsNarrowed(stored)).toBe(true);
  });

  it('keeps the standalone project pick when "show all" resets a hosted list', () => {
    expect(resetAcceptanceListFacets({ ...stored, scope: 'participated' }, 'host-project')).toEqual(
      { projectId: 'standalone-pick', scope: 'all', source: 'all' },
    );
    expect(resetAcceptanceListFacets(stored)).toEqual({ scope: 'all', source: 'all' });
  });
});
