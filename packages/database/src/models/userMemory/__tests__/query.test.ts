// @vitest-environment node
import { LayersEnum, RelationshipEnum, UserMemoryContextObjectType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';
import type { LayerBaseMemorySignals } from '../query';
import { scoreHybridCandidates } from '../query';

const userId = 'memory-query-test-user';

const serverDB: LobeChatDatabase = await getTestDB();

let memoryModel: UserMemoryModel;

beforeEach(async () => {
  await serverDB.delete(userMemoriesActivities);
  await serverDB.delete(userMemoriesContexts);
  await serverDB.delete(userMemories);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }]);
  memoryModel = new UserMemoryModel(serverDB, userId);
});

const createActivityPair = async (opts: {
  capturedAt?: Date;
  memoryTags?: string[];
  narrative?: string;
  tags?: string[];
  title?: string;
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'activity details',
      capturedAt: opts.capturedAt,
      lastAccessedAt: new Date(),
      memoryLayer: 'activity',
      memoryType: 'activity',
      summary: 'activity summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Activity memory',
      userId,
    })
    .returning();

  const [activity] = await serverDB
    .insert(userMemoriesActivities)
    .values({
      capturedAt: opts.capturedAt,
      narrative: opts.narrative ?? 'did a thing',
      status: 'completed',
      tags: opts.tags,
      type: 'task',
      userId,
      userMemoryId: memory.id,
    })
    .returning();

  return { activity, memory };
};

const createContextPair = async (opts: {
  description?: string;
  memoryTags?: string[];
  tags?: string[];
  title?: string;
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'context details',
      lastAccessedAt: new Date(),
      memoryLayer: 'context',
      memoryType: 'context',
      summary: 'context summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Context memory',
      userId,
    })
    .returning();

  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      associatedObjects: [{ name: 'Linear', type: UserMemoryContextObjectType.Application }],
      description: opts.description ?? 'A context description',
      tags: opts.tags,
      title: opts.title ?? 'Atlas context',
      type: 'project',
      userId,
      userMemoryIds: [memory.id],
    })
    .returning();

  return { context, memory };
};

const createPreferencePair = async (opts: {
  conclusionDirectives?: string;
  createdAt?: Date;
  memoryTags?: string[];
  suggestions?: string;
  tags?: string[];
  title?: string;
  type?: string;
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'preference details',
      lastAccessedAt: new Date(),
      memoryLayer: 'preference',
      memoryType: 'preference',
      summary: 'preference summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Preference memory',
      userId,
    })
    .returning();

  const [preference] = await serverDB
    .insert(userMemoriesPreferences)
    .values({
      conclusionDirectives: opts.conclusionDirectives ?? 'Prefer typed APIs',
      createdAt: opts.createdAt,
      suggestions: opts.suggestions ?? 'Add more integration tests',
      tags: opts.tags,
      type: opts.type ?? 'coding-style',
      userId,
      userMemoryId: memory.id,
    })
    .returning();

  return { memory, preference };
};

const createIdentityPair = async (opts: {
  capturedAt?: Date;
  description?: string;
  episodicDate?: Date;
  memoryTags?: string[];
  relationship?: RelationshipEnum;
  role?: string;
  tags?: string[];
  title?: string;
  type?: 'demographic' | 'personal' | 'professional';
}) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'identity details',
      lastAccessedAt: new Date(),
      memoryLayer: 'identity',
      memoryType: 'identity',
      summary: 'identity summary',
      tags: opts.memoryTags ?? opts.tags,
      title: opts.title ?? 'Identity memory',
      userId,
    })
    .returning();

  const [identity] = await serverDB
    .insert(userMemoriesIdentities)
    .values({
      capturedAt: opts.capturedAt,
      description: opts.description ?? 'Identity description',
      episodicDate: opts.episodicDate,
      relationship: opts.relationship ?? RelationshipEnum.Self,
      role: opts.role ?? 'Engineer',
      tags: opts.tags,
      type: opts.type ?? 'personal',
      userId,
      userMemoryId: memory.id,
    })
    .returning();

  return { identity, memory };
};

describe('user memory query layer', () => {
  describe('queryTaxonomyOptions', () => {
    it('merges repeated labels across layers', async () => {
      await createActivityPair({ tags: ['shared-label'] });
      await createContextPair({ tags: ['shared-label'] });

      const result = await memoryModel.queryTaxonomyOptions({
        include: ['labels'],
        limit: 10,
      });

      expect(result.labels).toContainEqual({
        count: 2,
        layers: [LayersEnum.Activity, LayersEnum.Context],
        value: 'shared-label',
      });
    });

    it('escapes wildcard characters in taxonomy q filters', async () => {
      await createActivityPair({ memoryTags: ['100% ready'], tags: ['alpha'] });
      await createActivityPair({ memoryTags: ['plain'], tags: ['beta'] });

      const result = await memoryModel.queryTaxonomyOptions({
        include: ['tags'],
        limit: 10,
        q: '%',
      });

      expect(result.tags).toEqual([
        {
          count: 1,
          layers: undefined,
          value: '100% ready',
        },
      ]);
    });
  });

  describe('scoreHybridCandidates', () => {
    it('boosts semantically-related candidates with temporal and cluster affinity', () => {
      const seedTime = new Date('2026-03-20T10:00:00.000Z').getTime();
      const baseSignals = new Map<string, LayerBaseMemorySignals>([
        [
          'seed',
          {
            categories: ['project'],
            memoryIds: ['memory-seed'],
            tags: ['atlas', 'roadmap'],
            times: [seedTime],
          },
        ],
        [
          'boosted',
          {
            categories: ['project'],
            memoryIds: ['memory-boosted'],
            tags: ['atlas', 'dependency'],
            times: [seedTime + 1000 * 60 * 60],
          },
        ],
        [
          'weak',
          {
            categories: ['personal'],
            memoryIds: ['memory-weak'],
            tags: ['shopping'],
            times: [seedTime + 1000 * 60 * 60 * 24 * 14],
          },
        ],
      ]);
      const lexicalSeed = {
        capturedAt: new Date(seedTime),
        id: 'seed',
        narrative: 'Project Atlas kickoff roadmap review',
        tags: ['atlas', 'roadmap'],
      };
      const boosted = {
        capturedAt: new Date(seedTime + 1000 * 60 * 60),
        id: 'boosted',
        narrative: 'Atlas dependency review',
        tags: ['atlas', 'dependency'],
      };
      const weak = {
        capturedAt: new Date(seedTime + 1000 * 60 * 60 * 24 * 14),
        id: 'weak',
        narrative: 'Weekend grocery shopping',
        tags: ['shopping'],
      };

      const result = scoreHybridCandidates({
        baseSignals,
        items: [lexicalSeed, boosted, weak],
        lexicalLists: [[lexicalSeed]],
        queries: ['atlas roadmap'],
        queryParams: {
          queries: ['atlas roadmap'],
          timeRange: {
            end: new Date(seedTime + 1000 * 60 * 60 * 24),
            field: 'capturedAt',
            start: new Date(seedTime - 1000 * 60 * 60),
          },
        },
        semanticLists: [[weak, boosted]],
      });

      const boostedScore = result.find((item) => item.item.id === 'boosted')?.score;
      const weakScore = result.find((item) => item.item.id === 'weak')?.score;

      expect(boostedScore?.clusterBoost).toBeGreaterThan(weakScore?.clusterBoost ?? 0);
      expect(boostedScore?.tagAffinity).toBeGreaterThan(weakScore?.tagAffinity ?? 0);
      expect(boostedScore?.temporal).toBeGreaterThan(weakScore?.temporal ?? 0);
      expect(boostedScore?.final).toBeGreaterThan(weakScore?.final ?? 0);
    });
  });

  describe('searchMemory', () => {
    it('requires all requested tags to match during lexical filter-only search', async () => {
      const { activity: exactMatch } = await createActivityPair({
        memoryTags: ['atlas', 'urgent'],
        tags: ['atlas', 'urgent'],
        title: 'Atlas urgent task',
      });
      await createActivityPair({
        memoryTags: ['atlas'],
        tags: ['atlas'],
        title: 'Atlas general task',
      });

      const result = await memoryModel.searchMemory({
        layers: [LayersEnum.Activity],
        tags: ['atlas', 'urgent'],
        topK: { activities: 5, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
      });

      expect(result.activities.map((item) => item.id)).toEqual([exactMatch.id]);
    });

    it('does not execute retrieval for layers with topK set to zero', async () => {
      const queryModel = Reflect.get(memoryModel, 'queryModel') as {
        searchHybridActivities: (...args: unknown[]) => Promise<unknown[]>;
        searchHybridContexts: (...args: unknown[]) => Promise<unknown[]>;
      };
      const activitySpy = vi.spyOn(queryModel, 'searchHybridActivities').mockResolvedValue([]);
      const contextSpy = vi.spyOn(queryModel, 'searchHybridContexts').mockResolvedValue([]);

      await memoryModel.searchMemory({
        layers: [LayersEnum.Activity, LayersEnum.Context],
        queries: ['atlas roadmap'],
        topK: { activities: 1, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
      });

      expect(activitySpy).toHaveBeenCalledOnce();
      expect(contextSpy).not.toHaveBeenCalled();
    });

    it('runs one lexical and one semantic retrieval per layer even with multiple queries', async () => {
      const queryModel = Reflect.get(memoryModel, 'queryModel') as {
        searchActivitiesLexical: (...args: unknown[]) => Promise<unknown[]>;
        searchActivitiesSemantic: (...args: unknown[]) => Promise<unknown[]>;
      };
      const lexicalSpy = vi.spyOn(queryModel, 'searchActivitiesLexical').mockResolvedValue([]);
      const semanticSpy = vi.spyOn(queryModel, 'searchActivitiesSemantic').mockResolvedValue([]);

      await memoryModel.searchMemory(
        {
          layers: [LayersEnum.Activity],
          queries: ['atlas roadmap', 'dependency review', 'migration plan'],
          topK: { activities: 2, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
        },
        [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ],
      );

      expect(lexicalSpy).toHaveBeenCalledOnce();
      expect(semanticSpy).toHaveBeenCalledOnce();
    });

    it('deduplicates contexts before applying the lexical candidate limit', async () => {
      const { memory: linkedMemoryOne } = await createContextPair({
        description: 'Atlas roadmap and staffing',
        memoryTags: ['atlas'],
        tags: ['atlas'],
        title: 'Atlas staffing',
      });
      const { memory: linkedMemoryTwo } = await createContextPair({
        description: 'Atlas roadmap and staffing duplicate link',
        memoryTags: ['atlas'],
        tags: ['atlas'],
        title: 'Atlas staffing duplicate',
      });
      const { context: duplicatedContext } = await createContextPair({
        description: 'Atlas roadmap and staffing canonical context',
        memoryTags: ['atlas'],
        tags: ['atlas'],
        title: 'Atlas canonical context',
      });
      await serverDB
        .update(userMemoriesContexts)
        .set({ userMemoryIds: [linkedMemoryOne.id, linkedMemoryTwo.id] })
        .where(eq(userMemoriesContexts.id, duplicatedContext.id));

      const { context: distinctContext } = await createContextPair({
        description: 'Atlas dependency review',
        memoryTags: ['atlas'],
        tags: ['atlas'],
        title: 'Atlas dependency context',
      });

      const result = await memoryModel.searchMemory({
        layers: [LayersEnum.Context],
        tags: ['atlas'],
        topK: { activities: 0, contexts: 2, experiences: 0, identities: 0, preferences: 0 },
      });

      expect(result.contexts).toHaveLength(2);
      expect(new Set(result.contexts.map((item) => item.id))).toEqual(
        new Set([duplicatedContext.id, distinctContext.id]),
      );
    });

    it('returns lexical preference matches when filtering by type without semantic search', async () => {
      const { preference: expectedPreference } = await createPreferencePair({
        conclusionDirectives: 'Prefer strongly typed APIs',
        createdAt: new Date('2026-03-01T08:00:00.000Z'),
        memoryTags: ['typescript', 'quality'],
        suggestions: 'Add query regression coverage',
        tags: ['typescript', 'quality'],
        title: 'TypeScript preference',
        type: 'coding-style',
      });
      await createPreferencePair({
        conclusionDirectives: 'Keep product notes concise',
        createdAt: new Date('2026-03-02T08:00:00.000Z'),
        memoryTags: ['writing'],
        suggestions: 'Shorten changelog entries',
        tags: ['writing'],
        title: 'Writing preference',
        type: 'communication-style',
      });

      const result = await memoryModel.searchMemory({
        layers: [LayersEnum.Preference],
        tags: ['typescript', 'quality'],
        topK: { activities: 0, contexts: 0, experiences: 0, identities: 0, preferences: 3 },
        types: ['coding-style'],
      });

      expect(result.preferences.map((item) => item.id)).toEqual([expectedPreference.id]);
    });

    it('returns lexical identity matches when filters use relationship and episodic date', async () => {
      const { identity: expectedIdentity } = await createIdentityPair({
        capturedAt: new Date('2026-03-20T10:00:00.000Z'),
        description: 'Primary project stakeholder for Atlas',
        episodicDate: new Date('2026-03-20T00:00:00.000Z'),
        memoryTags: ['atlas', 'stakeholder'],
        relationship: RelationshipEnum.Friend,
        role: 'Project sponsor',
        tags: ['atlas', 'stakeholder'],
        title: 'Atlas sponsor',
      });
      await createIdentityPair({
        capturedAt: new Date('2026-02-01T10:00:00.000Z'),
        description: 'Archived collaborator profile',
        episodicDate: new Date('2026-02-01T00:00:00.000Z'),
        memoryTags: ['legacy'],
        relationship: RelationshipEnum.Friend,
        role: 'Observer',
        tags: ['legacy'],
        title: 'Legacy observer',
      });

      const result = await memoryModel.searchMemory({
        layers: [LayersEnum.Identity],
        relationships: [RelationshipEnum.Friend],
        tags: ['atlas', 'stakeholder'],
        timeRange: {
          end: new Date('2026-03-21T00:00:00.000Z'),
          field: 'episodicDate',
          start: new Date('2026-03-19T00:00:00.000Z'),
        },
        topK: { activities: 0, contexts: 0, experiences: 0, identities: 3, preferences: 0 },
        types: ['personal'],
      });

      expect(result.identities.map((item) => item.id)).toEqual([expectedIdentity.id]);
    });
  });
});
