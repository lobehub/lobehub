// @vitest-environment node
import { LayersEnum } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { drizzle as drizzleProxy } from 'drizzle-orm/pg-proxy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import * as schema from '../../../schemas';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  userPersonaDocuments,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { LayerBaseMemorySignals } from '../query';
import { UserMemoryQueryModel } from '../query';
import { buildUserMemoryWhere } from '../where';

const userId = 'memory-query-layers-user';
const otherUserId = 'memory-query-layers-other-user';

const serverDB: LobeChatDatabase = await getTestDB();

type Rows = Array<{ id: string } & Record<string, unknown>>;
type LexicalSearch = (query: string | undefined, limit: number, params: object) => Promise<Rows>;
type SemanticSearch = (embedding: number[], limit: number, params: object) => Promise<Rows>;

interface QueryContext {
  loadBaseSignals: (
    items: Array<{ id: string; userMemoryId?: string | null }>,
  ) => Promise<Map<string, LayerBaseMemorySignals>>;
  searchActivitiesLexical: LexicalSearch;
  searchContextsLexical: LexicalSearch;
  searchContextsSemantic: SemanticSearch;
  searchExperiencesLexical: LexicalSearch;
  searchExperiencesSemantic: SemanticSearch;
  searchHybridExperiences: (params: {
    embeddings: number[][];
    lexicalSearch: boolean;
    params: object;
    queries: string[];
  }) => Promise<Array<{ item: { id: string } }>>;
  searchIdentitiesLexical: LexicalSearch;
  searchIdentitiesSemantic: SemanticSearch;
  searchPreferencesLexical: LexicalSearch;
  searchPreferencesSemantic: SemanticSearch;
}

const contextOf = (model: UserMemoryQueryModel) => Reflect.get(model, 'context') as QueryContext;

const vec = (seed: number) => Array.from({ length: 1024 }, (_, index) => (index === 0 ? seed : 1));

const insertBaseMemory = async (
  layer: string,
  values: Partial<typeof userMemories.$inferInsert>,
) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: `${layer} details`,
      lastAccessedAt: new Date(),
      memoryLayer: layer,
      memoryType: layer,
      summary: `${layer} summary`,
      title: `${layer} memory`,
      userId,
      ...values,
    })
    .returning();

  return memory;
};

const insertExperience = async (opts: {
  memoryCategory?: string;
  tags?: string[];
  type: string;
}) => {
  const memory = await insertBaseMemory('experience', { memoryCategory: opts.memoryCategory });
  const [experience] = await serverDB
    .insert(userMemoriesExperiences)
    .values({
      situation: `situation for ${opts.type}`,
      situationVector: vec(1),
      tags: opts.tags,
      type: opts.type,
      userId,
      userMemoryId: memory.id,
    })
    .returning();

  return experience;
};

const insertContext = async (opts: {
  currentStatus?: string;
  tags?: string[];
  type?: string | null;
}) => {
  const memory = await insertBaseMemory('context', {});
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      currentStatus: opts.currentStatus,
      description: 'context description',
      descriptionVector: vec(1),
      tags: opts.tags,
      title: 'context title',
      type: opts.type,
      userId,
      userMemoryIds: [memory.id],
    })
    .returning();

  return context;
};

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('UserMemoryQueryModel layer retrieval', () => {
  describe('experiences', () => {
    it('filters lexical experiences by category and type without a query', async () => {
      const lesson = await insertExperience({ memoryCategory: 'work', type: 'lesson' });
      await insertExperience({ memoryCategory: 'work', type: 'mistake' });
      await insertExperience({ memoryCategory: 'life', type: 'lesson' });

      const rows = await contextOf(
        new UserMemoryQueryModel(serverDB, userId),
      ).searchExperiencesLexical(undefined, 10, { categories: ['work'], types: ['lesson'] });

      expect(rows.map(({ id }) => id)).toEqual([lesson.id]);
    });

    it('narrows lexical experiences to the external candidates for a query', async () => {
      const wanted = await insertExperience({ type: 'lesson' });
      await insertExperience({ type: 'lesson' });
      const ftsSearchCandidates = vi
        .fn()
        .mockResolvedValue({ candidates: [{ id: wanted.id, score: 1 }], total: 1 });
      const model = new UserMemoryQueryModel(serverDB, userId, {
        ftsSearchCandidateEnabled: true,
        ftsSearchCandidates,
      });

      const rows = await contextOf(model).searchExperiencesLexical('  migration  ', 4, {});

      expect(rows.map(({ id }) => id)).toEqual([wanted.id]);
      expect(ftsSearchCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'memoryExperiences',
          pagination: { limit: 4 },
          query: expect.objectContaining({ text: 'migration' }),
        }),
      );
    });

    it('filters semantic experiences by type and leaves other users out', async () => {
      const lesson = await insertExperience({ type: 'lesson' });
      await insertExperience({ type: 'mistake' });

      const rows = await contextOf(
        new UserMemoryQueryModel(serverDB, userId),
      ).searchExperiencesSemantic(vec(1), 10, { types: ['lesson'] });
      const otherRows = await contextOf(
        new UserMemoryQueryModel(serverDB, otherUserId),
      ).searchExperiencesSemantic(vec(1), 10, {});

      expect(rows.map(({ id }) => id)).toEqual([lesson.id]);
      expect(otherRows).toEqual([]);
    });

    it('ranks filtered experiences through the hybrid pipeline', async () => {
      const lesson = await insertExperience({ tags: ['db'], type: 'lesson' });
      await insertExperience({ type: 'mistake' });

      const ranked = await contextOf(
        new UserMemoryQueryModel(serverDB, userId),
      ).searchHybridExperiences({
        embeddings: [],
        lexicalSearch: true,
        params: { types: ['lesson'] },
        queries: [],
      });

      expect(ranked.map(({ item }) => item.id)).toEqual([lesson.id]);
    });
  });

  describe('contexts', () => {
    it('filters lexical and semantic contexts by current status and type', async () => {
      const active = await insertContext({ currentStatus: 'active', type: 'project' });
      await insertContext({ currentStatus: 'paused', type: 'project' });
      await insertContext({ currentStatus: 'active', type: 'goal' });
      const ctx = contextOf(new UserMemoryQueryModel(serverDB, userId));
      const params = { status: ['active'], types: ['project'] };

      const lexical = await ctx.searchContextsLexical(undefined, 10, params);
      const semantic = await ctx.searchContextsSemantic(vec(1), 10, params);

      expect(lexical.map(({ id }) => id)).toEqual([active.id]);
      expect(semantic.map(({ id }) => id)).toEqual([active.id]);
    });
  });

  describe('preferences and identities', () => {
    it('returns unfiltered semantic preferences of the user only', async () => {
      const memory = await insertBaseMemory('preference', {});
      const [preference] = await serverDB
        .insert(userMemoriesPreferences)
        .values({
          conclusionDirectives: 'prefer dark mode',
          conclusionDirectivesVector: vec(1),
          type: 'ui',
          userId,
          userMemoryId: memory.id,
        })
        .returning();

      const rows = await contextOf(
        new UserMemoryQueryModel(serverDB, userId),
      ).searchPreferencesSemantic(vec(1), 10, {});

      expect(rows.map(({ id }) => id)).toEqual([preference.id]);
    });

    it('filters semantic identities by type without category or relationship filters', async () => {
      const identities: Array<{ id: string }> = [];
      for (const type of ['personal', 'professional']) {
        const memory = await insertBaseMemory('identity', {});
        const [identity] = await serverDB
          .insert(userMemoriesIdentities)
          .values({
            description: `${type} identity`,
            descriptionVector: vec(1),
            type,
            userId,
            userMemoryId: memory.id,
          })
          .returning();
        identities.push(identity);
      }

      const rows = await contextOf(
        new UserMemoryQueryModel(serverDB, userId),
      ).searchIdentitiesSemantic(vec(1), 10, { types: ['professional'] });

      expect(rows.map(({ id }) => id)).toEqual([identities[1].id]);
    });
  });

  describe('lexical queries without a candidate source', () => {
    it('matches each layer with BM25 over the base memory and the layer row', async () => {
      const statements: string[] = [];
      const captureDB = drizzleProxy(
        async (query) => {
          statements.push(query);
          return { rows: [] };
        },
        { schema },
      ) as unknown as LobeChatDatabase;
      const ctx = contextOf(new UserMemoryQueryModel(captureDB, userId));

      const searches: Array<[LexicalSearch, string]> = [
        [ctx.searchActivitiesLexical, 'user_memories_activities'],
        [ctx.searchContextsLexical, 'user_memories_contexts'],
        [ctx.searchExperiencesLexical, 'user_memories_experiences'],
        [ctx.searchIdentitiesLexical, 'user_memories_identities'],
        [ctx.searchPreferencesLexical, 'user_memories_preferences'],
      ];

      for (const [search, table] of searches) {
        statements.length = 0;

        await expect(search('atlas', 5, {})).resolves.toEqual([]);
        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain('"user_memories"."id" @@@ paradedb.boolean');
        expect(statements[0]).toContain(`"${table}"."id" @@@ paradedb.boolean`);
      }
    });
  });

  describe('base signals', () => {
    it('ignores candidate items whose linked memory is not visible', async () => {
      const visible = await insertBaseMemory('activity', { memoryCategory: 'work', tags: ['a'] });
      const ctx = contextOf(new UserMemoryQueryModel(serverDB, userId));

      const signals = await ctx.loadBaseSignals([
        { id: 'item-missing', userMemoryId: 'memory-that-does-not-exist' },
        { id: 'item-visible', userMemoryId: visible.id },
      ]);

      expect(signals.get('item-missing')).toEqual({
        categories: [],
        memoryIds: [],
        tags: [],
        times: [],
      });
      expect(signals.get('item-visible')).toMatchObject({
        categories: ['work'],
        memoryIds: [visible.id],
        tags: ['a'],
      });
    });
  });

  describe('searchMemory', () => {
    it('uses the default per-layer limits when topK is omitted', async () => {
      const memory = await insertBaseMemory('activity', { memoryCategory: 'work' });
      const [activity] = await serverDB
        .insert(userMemoriesActivities)
        .values({ narrative: 'shipped it', type: 'task', userId, userMemoryId: memory.id })
        .returning();
      await insertExperience({ memoryCategory: 'work', type: 'lesson' });

      const result = await new UserMemoryQueryModel(serverDB, userId).searchMemory({
        categories: ['work'],
      });

      expect(result.activities.map(({ id }) => id)).toEqual([activity.id]);
      expect(result.experiences).toEqual([]);
      expect(result.meta.layers.activities).toEqual({ hasMore: false, returned: 1, total: 1 });
      expect(result.meta.layers.experiences).toEqual({ hasMore: false, returned: 0, total: 0 });
    });
  });

  describe('queryTaxonomyOptions', () => {
    it('restricts tags and labels to the requested layers', async () => {
      const activityMemory = await insertBaseMemory('activity', { tags: ['base-activity'] });
      await serverDB.insert(userMemoriesActivities).values({
        narrative: 'labelled',
        tags: ['label-activity'],
        type: 'task',
        userId,
        userMemoryId: activityMemory.id,
      });
      await insertContext({ tags: ['label-context'] });
      await insertBaseMemory('context', { tags: ['base-context'] });

      const result = await new UserMemoryQueryModel(serverDB, userId).queryTaxonomyOptions({
        include: ['labels', 'tags'],
        layers: [LayersEnum.Activity],
      });

      expect(result.tags).toEqual([{ count: 1, layers: undefined, value: 'base-activity' }]);
      expect(result.labels).toEqual([
        { count: 1, layers: [LayersEnum.Activity], value: 'label-activity' },
      ]);
    });

    it('drops contexts without a type from the type options', async () => {
      await insertContext({ type: null });
      await insertContext({ type: 'project' });

      const result = await new UserMemoryQueryModel(serverDB, userId).queryTaxonomyOptions({
        include: ['types'],
        layers: [LayersEnum.Context],
      });

      expect(result.types).toEqual([{ count: 1, layers: [LayersEnum.Context], value: 'project' }]);
    });
  });

  describe('buildUserMemoryWhere', () => {
    it('scopes a table without memory links to the user alone', async () => {
      await serverDB.insert(userPersonaDocuments).values([
        { persona: 'mine', userId },
        { persona: 'theirs', userId: otherUserId },
      ]);

      const rows = await serverDB
        .select({ persona: userPersonaDocuments.persona })
        .from(userPersonaDocuments)
        .where(buildUserMemoryWhere(serverDB, userId, { userId: userPersonaDocuments.userId }));

      expect(rows).toEqual([{ persona: 'mine' }]);
      expect(
        await serverDB
          .select({ id: userPersonaDocuments.id })
          .from(userPersonaDocuments)
          .where(eq(userPersonaDocuments.userId, otherUserId)),
      ).toHaveLength(1);
    });
  });
});
