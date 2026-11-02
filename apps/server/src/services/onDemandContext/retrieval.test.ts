import { hashContent } from '@lobechat/context-engine/onDemand';
import type { OnDemandContextCandidate, SearchMemoryResult } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type OnDemandServerRetrievalDeps, runOnDemandServerRetrieval } from './retrieval';

const emptyMemoryResult = (): SearchMemoryResult => ({
  activities: [],
  contexts: [],
  experiences: [],
  identities: [],
  preferences: [],
});

const preferenceResult = (): SearchMemoryResult => ({
  ...emptyMemoryResult(),
  meta: {
    appliedFilters: {},
    appliedQueries: ['deploy'],
    layers: {
      activities: { hasMore: false, returned: 0, total: 0 },
      contexts: { hasMore: false, returned: 0, total: 0 },
      experiences: { hasMore: false, returned: 0, total: 0 },
      identities: { hasMore: false, returned: 0, total: 0 },
      preferences: { hasMore: false, returned: 1, total: 1 },
    },
    ranking: {
      preferences: {
        'preference-1': {
          categoryAffinity: 0,
          clusterBoost: 0,
          final: 0.91,
          fuzzy: 0,
          keyword: 0.5,
          semantic: 1,
          tagAffinity: 0,
          temporal: 0,
        },
      },
    },
  },
  preferences: [
    {
      conclusionDirectives: 'Deploy with the blue-green checklist.',
      id: 'preference-1',
    } as SearchMemoryResult['preferences'][number],
  ],
});

const expertiseCandidate: OnDemandContextCandidate = {
  approval: { state: 'approved' },
  authority: 'approved_experience',
  content: 'deploy requires a rollback plan',
  contentHash: hashContent('deploy requires a rollback plan'),
  id: 'lesson-1',
  relevance: 0.8,
  scope: {
    ownerUserId: 'user-1',
    share: 'personal',
    shareGate: 'allowed',
  },
  source: { id: 'lesson-1', type: 'agent' },
};

const createDeps = (
  overrides: Partial<OnDemandServerRetrievalDeps> = {},
): OnDemandServerRetrievalDeps => ({
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  getExpertise: vi.fn().mockResolvedValue([]),
  getPersona: vi.fn().mockResolvedValue(undefined),
  searchMemory: vi.fn().mockResolvedValue(emptyMemoryResult()),
  ...overrides,
});

describe('runOnDemandServerRetrieval', () => {
  it('uses vector retrieval when query embedding succeeds', async () => {
    const deps = createDeps({
      getExpertise: vi.fn().mockResolvedValue([expertiseCandidate]),
      getPersona: vi.fn().mockResolvedValue({
        persona: '## Deployment\nUse blue-green deployment.',
        tagline: 'Deploy carefully',
      }),
      searchMemory: vi.fn().mockResolvedValue(preferenceResult()),
    });

    const batch = await runOnDemandServerRetrieval({
      currentUserMessage: 'deploy',
      deps,
      memoryEnabled: true,
      userId: 'user-1',
    });

    expect(batch.mode).toBe('vector');
    expect(batch.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(['preference-1', 'lesson-1']),
    );
    expect(batch.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relevance: 0.91,
          scope: expect.objectContaining({ ownerUserId: 'user-1', shareGate: 'allowed' }),
        }),
      ]),
    );
    expect(deps.searchMemory).toHaveBeenCalledWith(expect.any(Object), [[0.1, 0.2]]);
  });

  it('falls back to deterministic lexical retrieval when embedding fails', async () => {
    const deps = createDeps({
      embedQuery: vi.fn().mockRejectedValue(new Error('embedding unavailable')),
      searchMemory: vi.fn().mockResolvedValue(preferenceResult()),
    });

    const batch = await runOnDemandServerRetrieval({
      currentUserMessage: 'deploy',
      deps,
      memoryEnabled: true,
      userId: 'user-1',
    });

    expect(batch.mode).toBe('lexical_fallback');
    expect(deps.searchMemory).toHaveBeenCalledTimes(1);
    expect(deps.searchMemory).toHaveBeenCalledWith(expect.any(Object), []);
    expect(batch.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'preference-1' })]),
    );
  });

  it('retries with lexical retrieval when vector search throws', async () => {
    const searchMemory = vi
      .fn()
      .mockRejectedValueOnce(new Error('vector search failed'))
      .mockResolvedValueOnce(preferenceResult());
    const deps = createDeps({ searchMemory });

    const batch = await runOnDemandServerRetrieval({
      currentUserMessage: 'deploy',
      deps,
      memoryEnabled: true,
      userId: 'user-1',
    });

    expect(batch.mode).toBe('lexical_fallback');
    expect(searchMemory).toHaveBeenNthCalledWith(1, expect.any(Object), [[0.1, 0.2]]);
    expect(searchMemory).toHaveBeenNthCalledWith(2, expect.any(Object), []);
  });

  it('returns no hits without empty candidates when memory is disabled and expertise is empty', async () => {
    const deps = createDeps();

    const batch = await runOnDemandServerRetrieval({
      currentUserMessage: 'unmatched query',
      deps,
      memoryEnabled: false,
      userId: 'user-1',
    });

    expect(batch).toMatchObject({ candidates: [], mode: 'none' });
    expect(deps.embedQuery).not.toHaveBeenCalled();
    expect(deps.getPersona).not.toHaveBeenCalled();
    expect(deps.searchMemory).not.toHaveBeenCalled();
    expect(deps.getExpertise).toHaveBeenCalledTimes(1);
  });
});
