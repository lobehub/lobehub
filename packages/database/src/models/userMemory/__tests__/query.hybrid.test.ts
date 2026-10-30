// @vitest-environment node
import type { SearchMemoryParams } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { UserMemoryQueryContext } from '../query/context';
import {
  searchHybridActivities,
  searchHybridContexts,
  searchHybridExperiences,
  searchHybridIdentities,
  searchHybridPreferences,
} from '../query/hybrid';

interface Candidate {
  id: string;
  title?: string;
}

const searchParams = {} as SearchMemoryParams;

const createContext = (
  options: {
    filters?: boolean;
    limit?: number;
    lexical?: Candidate[];
    runSemantic?: boolean;
    semantic?: Candidate[];
  } = {},
) => {
  const { filters = false, lexical = [], limit = 20, runSemantic = true, semantic = [] } = options;

  const context = {
    getSearchOverfetchLimit: vi.fn(() => limit),
    hasSearchFilters: vi.fn(() => filters),
    loadBaseSignals: vi.fn(async () => new Map()),
    searchActivitiesLexical: vi.fn(async () => lexical),
    searchActivitiesSemantic: vi.fn(async () => semantic),
    searchContextsLexical: vi.fn(async () => lexical),
    searchContextsSemantic: vi.fn(async () => semantic),
    searchExperiencesLexical: vi.fn(async () => lexical),
    searchExperiencesSemantic: vi.fn(async () => semantic),
    searchIdentitiesLexical: vi.fn(async () => lexical),
    searchIdentitiesSemantic: vi.fn(async () => semantic),
    searchPreferencesLexical: vi.fn(async () => lexical),
    searchPreferencesSemantic: vi.fn(async () => semantic),
    shouldRunSemanticSearch: vi.fn(() => runSemantic),
  };

  return { context: context as unknown as UserMemoryQueryContext, spies: context };
};

const ids = (results: { item: Candidate }[]) => results.map(({ item }) => item.id);

describe('userMemory hybrid retrieval', () => {
  describe('early exit when the overfetch limit is exhausted', () => {
    it.each([
      ['activities', searchHybridActivities, 'searchActivitiesSemantic'],
      ['contexts', searchHybridContexts, 'searchContextsSemantic'],
      ['experiences', searchHybridExperiences, 'searchExperiencesSemantic'],
      ['identities', searchHybridIdentities, 'searchIdentitiesSemantic'],
      ['preferences', searchHybridPreferences, 'searchPreferencesSemantic'],
    ] as const)('returns [] for %s without touching the retrievers', async (_, search, spyName) => {
      const { context, spies } = createContext({ limit: 0 });

      const result = await search(context, {
        embeddings: [[0.1, 0.2]],
        lexicalSearch: true,
        params: searchParams,
        queries: ['anything'],
      });

      expect(result).toEqual([]);
      expect(spies[spyName]).not.toHaveBeenCalled();
      expect(spies.searchActivitiesLexical).not.toHaveBeenCalled();
    });
  });

  describe('searchHybridExperiences', () => {
    it('merges semantic and lexical candidates, deduping by id', async () => {
      const { context, spies } = createContext({
        lexical: [{ id: 'b', title: 'lexical-b' }, { id: 'c' }],
        semantic: [{ id: 'a' }, { id: 'b', title: 'semantic-b' }],
      });

      const result = await searchHybridExperiences(context, {
        embeddings: [[0.1, 0.2]],
        lexicalSearch: true,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(ids(result).sort()).toEqual(['a', 'b', 'c']);
      // The map keeps first-seen order but the lexical copy lands last, so it wins the dedupe.
      expect(result.find(({ item }) => item.id === 'b')?.item.title).toBe('lexical-b');
      expect(spies.searchExperiencesSemantic).toHaveBeenCalledWith([0.1, 0.2], 20, searchParams);
      expect(spies.searchExperiencesLexical).toHaveBeenCalledWith('alpha', 20, searchParams);
      expect(spies.loadBaseSignals).toHaveBeenCalledWith([
        { id: 'a' },
        { id: 'b', title: 'lexical-b' },
        { id: 'c' },
      ]);
    });

    it('averages multiple query embeddings before the semantic search', async () => {
      const { context, spies } = createContext({ semantic: [{ id: 'a' }] });

      await searchHybridExperiences(context, {
        embeddings: [
          [0.5, 0.5],
          [0.25, 0.75],
        ],
        lexicalSearch: false,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchExperiencesSemantic).toHaveBeenCalledWith(
        [0.375, 0.625],
        20,
        searchParams,
      );
    });

    it('skips semantic retrieval when no embeddings are provided', async () => {
      const { context, spies } = createContext({ lexical: [{ id: 'lex' }] });

      const result = await searchHybridExperiences(context, {
        embeddings: [],
        lexicalSearch: true,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchExperiencesSemantic).not.toHaveBeenCalled();
      expect(spies.searchExperiencesLexical).toHaveBeenCalledTimes(1);
      expect(ids(result)).toEqual(['lex']);
    });

    it('skips semantic retrieval when the semantic gate declines', async () => {
      const { context, spies } = createContext({ lexical: [{ id: 'lex' }], runSemantic: false });

      const result = await searchHybridExperiences(context, {
        embeddings: [[0.1]],
        lexicalSearch: true,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchExperiencesSemantic).not.toHaveBeenCalled();
      expect(spies.shouldRunSemanticSearch).toHaveBeenCalledWith(1, 1);
      expect(ids(result)).toEqual(['lex']);
    });

    it('skips lexical retrieval when there is neither a query nor a filter', async () => {
      const { context, spies } = createContext({ semantic: [{ id: 'sem' }] });

      const result = await searchHybridExperiences(context, {
        embeddings: [[0.1]],
        lexicalSearch: true,
        params: searchParams,
        queries: [],
      });

      expect(spies.searchExperiencesLexical).not.toHaveBeenCalled();
      expect(ids(result)).toEqual(['sem']);
    });

    it('runs lexical retrieval on filters alone and passes no retrieval query', async () => {
      const { context, spies } = createContext({ filters: true, lexical: [{ id: 'filtered' }] });

      const result = await searchHybridExperiences(context, {
        embeddings: [],
        lexicalSearch: true,
        params: searchParams,
        queries: [],
      });

      expect(spies.hasSearchFilters).toHaveBeenCalled();
      expect(spies.searchExperiencesLexical).toHaveBeenCalledWith(undefined, 20, searchParams);
      expect(ids(result)).toEqual(['filtered']);
      expect(spies.shouldRunSemanticSearch).not.toHaveBeenCalled();
    });

    it('honours lexicalSearch=false even when a query is present', async () => {
      const { context, spies } = createContext({ semantic: [{ id: 'sem' }] });

      const result = await searchHybridExperiences(context, {
        embeddings: [[0.1]],
        lexicalSearch: false,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchExperiencesLexical).not.toHaveBeenCalled();
      expect(ids(result)).toEqual(['sem']);
    });

    it('returns [] when both retrievers come back empty', async () => {
      const { context } = createContext();

      const result = await searchHybridExperiences(context, {
        embeddings: [[0.1]],
        lexicalSearch: true,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(result).toEqual([]);
    });
  });

  describe('identities and preferences delegates', () => {
    it('routes identities retrieval through the identity retrievers', async () => {
      const { context, spies } = createContext({ semantic: [{ id: 'identity' }] });

      const result = await searchHybridIdentities(context, {
        embeddings: [[0.1]],
        lexicalSearch: true,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchIdentitiesSemantic).toHaveBeenCalledTimes(1);
      expect(spies.searchIdentitiesLexical).toHaveBeenCalledTimes(1);
      expect(spies.searchActivitiesSemantic).not.toHaveBeenCalled();
      expect(ids(result)).toEqual(['identity']);
    });

    it('routes preferences retrieval through the preference retrievers', async () => {
      const { context, spies } = createContext({ lexical: [{ id: 'preference' }] });

      const result = await searchHybridPreferences(context, {
        embeddings: [],
        lexicalSearch: true,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchPreferencesSemantic).not.toHaveBeenCalled();
      expect(spies.searchPreferencesLexical).toHaveBeenCalledTimes(1);
      expect(ids(result)).toEqual(['preference']);
    });

    it('routes activities and contexts retrieval through their own retrievers', async () => {
      const { context, spies } = createContext({ semantic: [{ id: 'row' }] });

      const activities = await searchHybridActivities(context, {
        embeddings: [[0.1]],
        lexicalSearch: false,
        params: searchParams,
        queries: ['alpha'],
      });
      const contexts = await searchHybridContexts(context, {
        embeddings: [[0.1]],
        lexicalSearch: false,
        params: searchParams,
        queries: ['alpha'],
      });

      expect(spies.searchActivitiesSemantic).toHaveBeenCalledTimes(1);
      expect(spies.searchContextsSemantic).toHaveBeenCalledTimes(1);
      expect(ids(activities)).toEqual(['row']);
      expect(ids(contexts)).toEqual(['row']);
    });
  });
});
