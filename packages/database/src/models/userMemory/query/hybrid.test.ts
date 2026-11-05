// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserMemoryQueryContext } from './context';
import {
  searchHybridActivities,
  searchHybridContexts,
  searchHybridExperiences,
  searchHybridIdentities,
  searchHybridPreferences,
} from './hybrid';
import { scoreHybridCandidates } from './scoring';

vi.mock('./scoring', () => ({ scoreHybridCandidates: vi.fn(() => []) }));

describe('hybrid query budget', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['activities', searchHybridActivities],
    ['contexts', searchHybridContexts],
    ['experiences', searchHybridExperiences],
    ['identities', searchHybridIdentities],
    ['preferences', searchHybridPreferences],
  ] as const)('skips fuzzy comparison of long contexts for %s', async (layer, search) => {
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
