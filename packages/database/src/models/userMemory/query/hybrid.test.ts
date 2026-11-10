// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserMemoryQueryContext } from './context';
import type * as HybridModule from './hybrid';
import type { scoreHybridCandidates as ScoreHybridCandidates } from './scoring';

vi.mock('./scoring', () => ({ scoreHybridCandidates: vi.fn(() => []) }));

// The server-db suite runs with `isolate: false`, so another file may already have loaded
// `./hybrid` with the real scoring module; load a fresh copy that sees the mock.
let hybrid: typeof HybridModule;
let scoreHybridCandidates: typeof ScoreHybridCandidates;

beforeAll(async () => {
  vi.resetModules();
  hybrid = await import('./hybrid');
  ({ scoreHybridCandidates } = await import('./scoring'));
});

// Leave no mocked module behind for the files that share this module registry.
afterAll(() => {
  vi.doUnmock('./scoring');
  vi.resetModules();
});

describe('hybrid query budget', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['activities', 'searchHybridActivities'],
    ['contexts', 'searchHybridContexts'],
    ['experiences', 'searchHybridExperiences'],
    ['identities', 'searchHybridIdentities'],
    ['preferences', 'searchHybridPreferences'],
  ] as const)('skips fuzzy comparison of long contexts for %s', async (layer, name) => {
    const search = hybrid[name];
    const prefix = layer[0].toUpperCase() + layer.slice(1);
    const lexical = vi.fn(async () => []);
    const context = {
      getSearchOverfetchLimit: () => 10,
      hasSearchFilters: () => false,
      loadBaseSignals: async () => new Map(),
      [`search${prefix}Lexical`]: lexical,
    } as unknown as UserMemoryQueryContext;
    const queries = ['conversation context '.repeat(1000)];
    await search(context, { embeddings: [], lexicalSearch: false, params: {}, queries });
    expect(lexical).not.toHaveBeenCalled();
    expect(scoreHybridCandidates).toHaveBeenLastCalledWith(
      expect.objectContaining({ queries: [] }),
    );

    const shortQueries = ['short phrase'];
    await search(context, {
      embeddings: [],
      lexicalSearch: true,
      params: {},
      queries: shortQueries,
    });
    expect(lexical).toHaveBeenCalled();
    expect(scoreHybridCandidates).toHaveBeenLastCalledWith(
      expect.objectContaining({ queries: shortQueries }),
    );
  });
});
