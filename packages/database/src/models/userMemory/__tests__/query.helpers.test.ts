// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../../../type';
import type { LayerBaseMemorySignals } from '../query';
import { buildBm25MatchCondition, scoreHybridCandidates, UserMemoryQueryModel } from '../query';
import { DEFAULT_HYBRID_SEARCH_LIMIT } from '../query/constants';
import { coerceDate, combineEmbeddings } from '../query/utils';

interface QueryContextHelpers {
  buildCandidateFilters: (entity: string, params: Record<string, unknown>) => unknown;
  collectCandidateMemoryIds: (item: {
    userMemoryId?: string | null;
    userMemoryIds?: string[] | null;
  }) => string[];
  fetchFtsSearchCandidates: (params: {
    entity: string;
    fields: string[];
    limit: number;
    query: string;
    searchParams: Record<string, unknown>;
  }) => Promise<string[] | undefined>;
  getSearchLimit: (key: string, params: Record<string, unknown>) => number;
  getSearchOverfetchLimit: (key: string, params: Record<string, unknown>) => number;
}

const createContext = (ftsSearchCandidateSource?: unknown) =>
  Reflect.get(
    new UserMemoryQueryModel(
      {} as LobeChatDatabase,
      'query-helpers-user',
      ftsSearchCandidateSource as never,
    ),
    'context',
  ) as QueryContextHelpers;

const emptySignals = new Map<string, LayerBaseMemorySignals>();

describe('user memory query helpers', () => {
  describe('combineEmbeddings', () => {
    it('gives up when the first of several embeddings is empty', () => {
      expect(combineEmbeddings([[], [1, 2]])).toBeUndefined();
    });

    it('treats missing dimensions of shorter embeddings as zero', () => {
      expect(combineEmbeddings([[2, 4], [2]])).toEqual([2, 2]);
    });
  });

  describe('coerceDate', () => {
    it('rejects invalid Date instances and unparsable strings', () => {
      expect(coerceDate(new Date('not a date'))).toBeNull();
      expect(coerceDate('not a date')).toBeNull();
    });
  });

  describe('buildBm25MatchCondition', () => {
    it('returns no condition when every group has no fields', () => {
      expect(
        buildBm25MatchCondition('atlas', [{ fields: [], keyColumn: {} as never }]),
      ).toBeUndefined();
    });
  });

  describe('search limits', () => {
    it('falls back to the default limit for a layer without topK', () => {
      const ctx = createContext();

      expect(ctx.getSearchLimit('activities', {})).toBe(DEFAULT_HYBRID_SEARCH_LIMIT);
      expect(ctx.getSearchOverfetchLimit('activities', {})).toBe(DEFAULT_HYBRID_SEARCH_LIMIT * 3);
    });

    it('does not overfetch a layer whose topK is zero', () => {
      expect(createContext().getSearchOverfetchLimit('contexts', { topK: { contexts: 0 } })).toBe(
        0,
      );
    });
  });

  describe('collectCandidateMemoryIds', () => {
    it('returns no ids for an item without a linked memory', () => {
      const ctx = createContext();

      expect(ctx.collectCandidateMemoryIds({ userMemoryId: null })).toEqual([]);
      expect(ctx.collectCandidateMemoryIds({})).toEqual([]);
    });
  });

  describe('buildCandidateFilters', () => {
    const fullParams = {
      categories: ['work'],
      labels: ['label-a'],
      relationships: ['friend'],
      status: ['active'],
      tags: ['tag-a'],
      timeRange: { end: new Date('2026-02-01'), start: new Date('2026-01-01') },
      types: ['project'],
    };

    it('forwards every filter the entity supports', () => {
      const ctx = createContext();

      expect(ctx.buildCandidateFilters('memoryIdentities', fullParams)).toEqual({
        memoryCategories: ['work'],
        memoryRelationships: ['friend'],
        memoryTags: ['tag-a', 'label-a'],
        memoryTimeRange: fullParams.timeRange,
        memoryTypes: ['project'],
      });
      expect(ctx.buildCandidateFilters('memoryContexts', fullParams)).toEqual({
        memoryCategories: ['work'],
        memoryStatus: ['active'],
        memoryTags: ['tag-a', 'label-a'],
        memoryTimeRange: fullParams.timeRange,
        memoryTypes: ['project'],
      });
      expect(ctx.buildCandidateFilters('memoryActivities', fullParams)).toMatchObject({
        memoryStatus: ['active'],
      });
    });

    it('omits filters that are empty or not supported by the entity', () => {
      expect(createContext().buildCandidateFilters('memoryPreferences', fullParams)).toEqual({
        memoryCategories: ['work'],
        memoryTags: ['tag-a', 'label-a'],
        memoryTimeRange: fullParams.timeRange,
        memoryTypes: ['project'],
      });
      expect(createContext().buildCandidateFilters('memoryActivities', {})).toEqual({});
    });
  });

  describe('fetchFtsSearchCandidates', () => {
    const request = {
      entity: 'memoryActivities',
      fields: ['narrative'],
      limit: 3,
      query: 'atlas',
      searchParams: {},
    };

    it('returns undefined without a candidate source', async () => {
      await expect(createContext().fetchFtsSearchCandidates(request)).resolves.toBeUndefined();
    });

    it('returns undefined when the candidate source is disabled', async () => {
      const ftsSearchCandidates = vi.fn();
      const ctx = createContext({ ftsSearchCandidateEnabled: false, ftsSearchCandidates });

      await expect(ctx.fetchFtsSearchCandidates(request)).resolves.toBeUndefined();
      expect(ftsSearchCandidates).not.toHaveBeenCalled();
    });
  });

  describe('scoreHybridCandidates', () => {
    it('scores fuzzy similarity as zero for an item with no searchable text', () => {
      const [ranked] = scoreHybridCandidates({
        baseSignals: emptySignals,
        items: [{ id: '   ' }],
        lexicalLists: [[{ id: '   ' }]],
        queries: ['atlas'],
        queryParams: {},
        semanticLists: [],
      });

      expect(ranked.score.fuzzy).toBe(0);
      expect(ranked.score.keyword).toBe(1);
    });

    it('scores a separator-only query as no token overlap', () => {
      const [ranked] = scoreHybridCandidates({
        baseSignals: emptySignals,
        items: [{ id: 'mem1', tags: ['atlas'] }],
        lexicalLists: [[{ id: 'mem1', tags: ['atlas'] }]],
        queries: ['/'],
        queryParams: {},
        semanticLists: [],
      });

      expect(ranked.score.fuzzy).toBe(0);
    });

    it('scores blank tags as no affinity between candidates', () => {
      const items = [
        { id: 'mem-a', tags: ['  '] },
        { id: 'mem-b', tags: ['  '] },
      ];

      const ranked = scoreHybridCandidates({
        baseSignals: emptySignals,
        items,
        lexicalLists: [items],
        queries: [],
        queryParams: {},
        semanticLists: [],
      });

      expect(ranked).toHaveLength(2);
      for (const { score } of ranked) {
        expect(score.tagAffinity).toBe(0);
        expect(score.clusterBoost).toBe(0);
      }
    });
  });
});
