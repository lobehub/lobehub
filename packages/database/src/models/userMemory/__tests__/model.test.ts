// @vitest-environment node
import {
  ActivityTypeEnum,
  IdentityTypeEnum,
  LayersEnum,
  MergeStrategyEnum,
  RelationshipEnum,
  TypesEnum,
  UserMemoryContextObjectType,
} from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';

const userId = 'memory-model-test-user';
const otherUserId = 'other-memory-model-user';

let memoryModel: UserMemoryModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(userMemoriesActivities);
  await serverDB.delete(userMemoriesContexts);
  await serverDB.delete(userMemoriesExperiences);
  await serverDB.delete(userMemoriesIdentities);
  await serverDB.delete(userMemoriesPreferences);
  await serverDB.delete(userMemories);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  memoryModel = new UserMemoryModel(serverDB, userId);
});

// Helper to create a base memory + identity pair
async function createIdentityPair(opts: {
  baseTitle?: string;
  description?: string;
  relationship?: string;
  role?: string;
  tags?: string[];
  type?: string;
  user?: string;
}) {
  const uid = opts.user ?? userId;
  const [mem] = await serverDB
    .insert(userMemories)
    .values({
      details: 'details',
      lastAccessedAt: new Date(),
      memoryLayer: 'identity',
      memoryType: 'identity',
      summary: 'summary',
      tags: opts.tags,
      title: opts.baseTitle ?? 'Identity memory',
      userId: uid,
    })
    .returning();

  const [id] = await serverDB
    .insert(userMemoriesIdentities)
    .values({
      description: opts.description ?? 'A test identity',
      relationship: opts.relationship ?? RelationshipEnum.Self,
      role: opts.role,
      tags: opts.tags,
      type: opts.type ?? 'personal',
      userId: uid,
      userMemoryId: mem.id,
    })
    .returning();

  return { identity: id, memory: mem };
}

// Helper to create a base memory + experience pair
async function createExperiencePair(opts?: {
  action?: string;
  possibleOutcome?: string;
  reasoning?: string;
  tags?: string[];
  type?: string;
  user?: string;
}) {
  const uid = opts?.user ?? userId;
  const [mem] = await serverDB
    .insert(userMemories)
    .values({
      details: 'exp details',
      lastAccessedAt: new Date(),
      memoryLayer: 'experience',
      memoryType: 'experience',
      summary: 'exp summary',
      tags: opts?.tags,
      title: 'Experience memory',
      userId: uid,
    })
    .returning();

  const [exp] = await serverDB
    .insert(userMemoriesExperiences)
    .values({
      action: opts?.action ?? 'did something',
      keyLearning: 'learned stuff',
      possibleOutcome: opts?.possibleOutcome ?? 'better outcomes',
      reasoning: opts?.reasoning ?? 'careful reasoning',
      situation: 'a situation',
      tags: opts?.tags,
      type: opts?.type ?? 'learning',
      userId: uid,
      userMemoryId: mem.id,
    })
    .returning();

  return { experience: exp, memory: mem };
}

// Helper to create a base memory + preference pair
async function createPreferencePair(opts?: {
  conclusionDirectives?: string;
  suggestions?: string;
  tags?: string[];
  type?: string;
  user?: string;
}) {
  const uid = opts?.user ?? userId;
  const [mem] = await serverDB
    .insert(userMemories)
    .values({
      details: 'pref details',
      lastAccessedAt: new Date(),
      memoryLayer: 'preference',
      memoryType: 'preference',
      summary: 'pref summary',
      tags: opts?.tags,
      title: 'Preference memory',
      userId: uid,
    })
    .returning();

  const [pref] = await serverDB
    .insert(userMemoriesPreferences)
    .values({
      conclusionDirectives: opts?.conclusionDirectives ?? 'use dark mode',
      suggestions: opts?.suggestions ?? 'keep it concise',
      tags: opts?.tags,
      type: opts?.type ?? 'ui',
      userId: uid,
      userMemoryId: mem.id,
    })
    .returning();

  return { memory: mem, preference: pref };
}

// Helper to create a base memory + activity pair
async function createActivityPair(opts?: {
  capturedAt?: Date;
  memoryCategory?: string | null;
  narrative?: string;
  notes?: string;
  status?: string;
  summary?: string;
  tags?: string[];
  title?: string;
  type?: string;
  user?: string;
}) {
  const uid = opts?.user ?? userId;
  const [mem] = await serverDB
    .insert(userMemories)
    .values({
      details: 'activity details',
      capturedAt: opts?.capturedAt,
      lastAccessedAt: new Date(),
      memoryCategory: opts?.memoryCategory ?? null,
      memoryLayer: 'activity',
      memoryType: 'activity',
      summary: opts?.summary ?? 'activity summary',
      tags: opts?.tags,
      title: opts?.title ?? 'Activity memory',
      userId: uid,
    })
    .returning();

  const [act] = await serverDB
    .insert(userMemoriesActivities)
    .values({
      capturedAt: opts?.capturedAt,
      narrative: opts?.narrative ?? 'did a thing',
      notes: opts?.notes ?? 'important note',
      status: opts?.status ?? 'completed',
      tags: opts?.tags,
      type: opts?.type ?? 'task',
      userId: uid,
      userMemoryId: mem.id,
    })
    .returning();

  return { activity: act, memory: mem };
}

// Helper to create a base memory + context pair
async function createContextPair(opts?: {
  associatedObjectName?: string;
  associatedSubjectName?: string;
  description?: string;
  tags?: string[];
  title?: string;
  type?: string;
  user?: string;
}) {
  const uid = opts?.user ?? userId;
  const [mem] = await serverDB
    .insert(userMemories)
    .values({
      details: 'context details',
      lastAccessedAt: new Date(),
      memoryLayer: 'context',
      memoryType: 'context',
      summary: 'context summary',
      tags: opts?.tags,
      title: opts?.title ?? 'Context memory',
      userId: uid,
    })
    .returning();

  const [ctx] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      associatedObjects: opts?.associatedObjectName
        ? [{ name: opts.associatedObjectName, type: UserMemoryContextObjectType.Application }]
        : [],
      associatedSubjects: opts?.associatedSubjectName
        ? [{ name: opts.associatedSubjectName, type: 'person' }]
        : [],
      description: opts?.description ?? 'A context description',
      tags: opts?.tags,
      title: opts?.title ?? 'A context',
      type: opts?.type ?? 'project',
      userId: uid,
      userMemoryIds: [mem.id],
    })
    .returning();

  return { context: ctx, memory: mem };
}

describe('UserMemoryModel', () => {
  // ========== Static Methods ==========
  describe('parseAssociatedObjects', () => {
    it('should return empty array for non-array input', () => {
      expect(UserMemoryModel.parseAssociatedObjects(undefined)).toEqual([]);
      expect(UserMemoryModel.parseAssociatedObjects('string')).toEqual([]);
      expect(UserMemoryModel.parseAssociatedObjects(null)).toEqual([]);
    });

    it('should parse items with name field', () => {
      const result = UserMemoryModel.parseAssociatedObjects([{ name: 'test' }]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'test' });
    });

    it('should skip invalid items', () => {
      const result = UserMemoryModel.parseAssociatedObjects([null, 42, { noName: true }]);
      expect(result).toEqual([]);
    });
  });

  describe('parseAssociatedSubjects', () => {
    it('should return empty array for non-array input', () => {
      expect(UserMemoryModel.parseAssociatedSubjects(undefined)).toEqual([]);
    });

    it('should parse items with name field', () => {
      const result = UserMemoryModel.parseAssociatedSubjects([{ name: 'subject' }]);
      expect(result).toHaveLength(1);
    });
  });

  describe('parseAssociatedLocations', () => {
    it('should return empty array for null/undefined', () => {
      expect(UserMemoryModel.parseAssociatedLocations(null)).toEqual([]);
      expect(UserMemoryModel.parseAssociatedLocations(undefined)).toEqual([]);
    });

    it('should parse array of locations', () => {
      const result = UserMemoryModel.parseAssociatedLocations([
        { address: '123 Main St', name: 'Home', type: 'residential' },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        address: '123 Main St',
        name: 'Home',
        tags: undefined,
        type: 'residential',
      });
    });

    it('should handle object input (wraps in array)', () => {
      const result = UserMemoryModel.parseAssociatedLocations({ name: 'Office' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Office');
    });

    it('should handle tags array', () => {
      const result = UserMemoryModel.parseAssociatedLocations([
        { name: 'Place', tags: ['tag1', 'tag2'] },
      ]);
      expect(result[0].tags).toEqual(['tag1', 'tag2']);
    });

    it('should skip items with no valid fields', () => {
      const invalidLocation: Record<string, unknown> = { invalid: true };
      const result = UserMemoryModel.parseAssociatedLocations([invalidLocation]);
      expect(result).toEqual([]);
    });
  });

  describe('parseDateFromString', () => {
    it('should return null for falsy input', () => {
      expect(UserMemoryModel.parseDateFromString(null)).toBeNull();
      expect(UserMemoryModel.parseDateFromString(undefined)).toBeNull();
      expect(UserMemoryModel.parseDateFromString('')).toBeNull();
    });

    it('should parse valid date string', () => {
      const result = UserMemoryModel.parseDateFromString('2024-01-01T00:00:00Z');
      expect(result).toBeInstanceOf(Date);
    });

    it('should return Date as-is if valid', () => {
      const date = new Date('2024-01-01');
      expect(UserMemoryModel.parseDateFromString(date)).toBe(date);
    });

    it('should return null for invalid Date', () => {
      expect(UserMemoryModel.parseDateFromString(new Date('invalid'))).toBeNull();
    });

    it('should return null for non-string input', () => {
      expect(
        UserMemoryModel.parseDateFromString(
          42 as unknown as Parameters<typeof UserMemoryModel.parseDateFromString>[0],
        ),
      ).toBeNull();
    });
  });

  // ========== queryTags ==========
  describe('queryTags', () => {
    it('should return grouped tags with counts', async () => {
      await serverDB.insert(userMemories).values([
        {
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          tags: ['work', 'coding'],
          title: 'M1',
          userId,
        },
        {
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          tags: ['work', 'design'],
          title: 'M2',
          userId,
        },
      ]);

      const result = await memoryModel.queryTags();

      expect(result.length).toBeGreaterThanOrEqual(2);
      const workTag = result.find((r) => r.tag === 'work');
      expect(workTag?.count).toBe(2);
    });

    it('should filter by layers', async () => {
      await serverDB.insert(userMemories).values([
        {
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          tags: ['ctx-tag'],
          title: 'M1',
          userId,
        },
        {
          lastAccessedAt: new Date(),
          memoryLayer: 'experience',
          tags: ['exp-tag'],
          title: 'M2',
          userId,
        },
      ]);

      const result = await memoryModel.queryTags({ layers: [LayersEnum.Context] });
      const tags = result.map((r) => r.tag);
      expect(tags).toContain('ctx-tag');
      expect(tags).not.toContain('exp-tag');
    });

    it('should respect pagination', async () => {
      await serverDB.insert(userMemories).values(
        Array.from({ length: 15 }, (_, i) => ({
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          tags: [`tag-${i}`],
          title: `M${i}`,
          userId,
        })),
      );

      const page1 = await memoryModel.queryTags({ page: 1, size: 5 });
      expect(page1).toHaveLength(5);

      const page2 = await memoryModel.queryTags({ page: 2, size: 5 });
      expect(page2).toHaveLength(5);
    });

    it('should not include other user tags', async () => {
      await serverDB.insert(userMemories).values([
        {
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          tags: ['my-tag'],
          title: 'M1',
          userId,
        },
        {
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          tags: ['other-tag'],
          title: 'M2',
          userId: otherUserId,
        },
      ]);

      const result = await memoryModel.queryTags();
      const tags = result.map((r) => r.tag);
      expect(tags).toContain('my-tag');
      expect(tags).not.toContain('other-tag');
    });

    it('should return empty array when no tags exist', async () => {
      const result = await memoryModel.queryTags();
      expect(result).toEqual([]);
    });
  });

  // ========== queryIdentityRoles ==========
  describe('queryIdentityRoles', () => {
    it('should return tags and roles from self-relationship identities', async () => {
      await createIdentityPair({
        role: 'developer',
        tags: ['tech'],
      });
      await createIdentityPair({
        role: 'developer',
        tags: ['tech', 'senior'],
      });

      const result = await memoryModel.queryIdentityRoles();

      expect(result.tags.length).toBeGreaterThanOrEqual(1);
      const techTag = result.tags.find((t) => t.tag === 'tech');
      expect(techTag?.count).toBe(2);

      expect(result.roles.length).toBeGreaterThanOrEqual(1);
      const devRole = result.roles.find((r) => r.role === 'developer');
      expect(devRole?.count).toBe(2);
    });

    it('should not include other user identity roles', async () => {
      await createIdentityPair({ role: 'my-role' });
      await createIdentityPair({ role: 'other-role', user: otherUserId });

      const result = await memoryModel.queryIdentityRoles();
      const roles = result.roles.map((r) => r.role);
      expect(roles).toContain('my-role');
      expect(roles).not.toContain('other-role');
    });

    it('should return empty when no identities', async () => {
      const result = await memoryModel.queryIdentityRoles();
      expect(result).toEqual({ roles: [], tags: [] });
    });

    it('should respect pagination', async () => {
      for (let i = 0; i < 12; i++) {
        await createIdentityPair({ role: `role-${i}` });
      }
      const result = await memoryModel.queryIdentityRoles({ size: 5 });
      expect(result.roles.length).toBeLessThanOrEqual(5);
    });
  });

  // ========== queryMemories ==========
  describe('queryMemories', () => {
    describe('context layer', () => {
      it('should return context memories with pagination info', async () => {
        await createContextPair({});
        await createContextPair({ title: 'Second context' });

        const result = await memoryModel.queryMemories({ layer: LayersEnum.Context });

        expect(result.items.length).toBe(2);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
        expect(result.total).toBe(2);
      });

      // BM25 search requires pg_search extension (ParadeDB), not available in PGlite
      const isServerDB = process.env.TEST_SERVER_DB === '1';
      it.skipIf(!isServerDB)('should filter by text query', async () => {
        await createContextPair({ title: 'Apple project' });
        await createContextPair({ title: 'Banana project' });

        const result = await memoryModel.queryMemories({
          layer: LayersEnum.Context,
          q: 'Apple',
        });

        expect(result.items.length).toBe(1);
      });

      it('should not return other user data', async () => {
        await createContextPair({});
        await createContextPair({ user: otherUserId });

        const result = await memoryModel.queryMemories({ layer: LayersEnum.Context });
        expect(result.total).toBe(1);
      });
    });

    describe('activity layer', () => {
      it('should return activity memories', async () => {
        await createActivityPair({});

        const result = await memoryModel.queryMemories({ layer: LayersEnum.Activity });

        expect(result.items.length).toBe(1);
        expect(result.total).toBe(1);
      });
    });

    describe('experience layer', () => {
      it('should return experience memories', async () => {
        await createExperiencePair({});

        const result = await memoryModel.queryMemories({ layer: LayersEnum.Experience });

        expect(result.items.length).toBe(1);
        expect(result.total).toBe(1);
      });
    });

    describe('identity layer', () => {
      it('should return identity memories', async () => {
        await createIdentityPair({});

        const result = await memoryModel.queryMemories({ layer: LayersEnum.Identity });

        expect(result.items.length).toBe(1);
        expect(result.total).toBe(1);
      });
    });

    describe('preference layer', () => {
      it('should return preference memories', async () => {
        await createPreferencePair({});

        const result = await memoryModel.queryMemories({ layer: LayersEnum.Preference });

        expect(result.items.length).toBe(1);
        expect(result.total).toBe(1);
      });
    });

    describe('pagination', () => {
      it('should normalize negative page to 1', async () => {
        await createActivityPair({});

        const result = await memoryModel.queryMemories({
          layer: LayersEnum.Activity,
          page: -1,
        });

        expect(result.page).toBe(1);
      });

      it('should cap pageSize at 100', async () => {
        const result = await memoryModel.queryMemories({
          layer: LayersEnum.Activity,
          pageSize: 200,
        });

        expect(result.pageSize).toBe(100);
      });

      it('should return empty items for unknown layer', async () => {
        const result = await memoryModel.queryMemories({
          layer: 'unknown-layer' as unknown as LayersEnum,
        });

        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });
    });
  });

  describe('searchMemory', () => {
    it('boosts short-term related memories with matching tags and category during hybrid ranking', async () => {
      const seedTime = new Date('2024-01-10T10:00:00.000Z');
      const boostedTime = new Date('2024-01-10T16:00:00.000Z');
      const unrelatedTime = new Date('2024-02-01T10:00:00.000Z');

      const { activity: lexicalSeed } = await createActivityPair({
        capturedAt: seedTime,
        memoryCategory: 'project',
        narrative: 'Project Atlas kickoff with roadmap review',
        summary: 'Atlas kickoff',
        tags: ['atlas', 'roadmap'],
        title: 'Atlas kickoff',
      });
      const { activity: boostedSemantic } = await createActivityPair({
        capturedAt: boostedTime,
        memoryCategory: 'project',
        narrative: 'Atlas follow-up on roadmap dependencies',
        summary: 'Atlas follow-up',
        tags: ['atlas', 'dependency'],
        title: 'Atlas dependency review',
      });
      const { activity: unrelatedSemantic } = await createActivityPair({
        capturedAt: unrelatedTime,
        memoryCategory: 'personal',
        narrative: 'Weekend grocery shopping',
        summary: 'Groceries',
        tags: ['shopping'],
        title: 'Buy groceries',
      });

      const queryModel = Reflect.get(memoryModel, 'queryModel') as {
        searchActivitiesLexical: (...args: unknown[]) => Promise<(typeof lexicalSeed)[]>;
        searchActivitiesSemantic: (...args: unknown[]) => Promise<(typeof boostedSemantic)[]>;
      };
      queryModel.searchActivitiesLexical = async () => [lexicalSeed];
      queryModel.searchActivitiesSemantic = async () => [unrelatedSemantic, boostedSemantic];

      const result = await memoryModel.searchMemory(
        {
          layers: [LayersEnum.Activity],
          queries: ['project atlas roadmap'],
          topK: { activities: 3, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
        },
        [[0.1, 0.2, 0.3]],
      );

      expect(result.activities.map((item) => item.id)).toEqual([
        lexicalSeed.id,
        boostedSemantic.id,
        unrelatedSemantic.id,
      ]);
      expect(result.meta.ranking?.activities?.[boostedSemantic.id]?.clusterBoost).toBeGreaterThan(
        result.meta.ranking?.activities?.[unrelatedSemantic.id]?.clusterBoost ?? 0,
      );
      expect(result.meta.ranking?.activities?.[boostedSemantic.id]?.final).toBeGreaterThan(
        result.meta.ranking?.activities?.[unrelatedSemantic.id]?.final ?? 0,
      );
    });

    it('runs semantic and lexical ranking together even when exact filters are present', async () => {
      const lexicalSearch = vi.fn().mockResolvedValue([]);
      const semanticSearch = vi.fn().mockResolvedValue([]);

      const queryModel = Reflect.get(memoryModel, 'queryModel') as {
        searchActivitiesLexical: typeof lexicalSearch;
        searchActivitiesSemantic: typeof semanticSearch;
      };
      queryModel.searchActivitiesLexical = lexicalSearch;
      queryModel.searchActivitiesSemantic = semanticSearch;

      await memoryModel.searchMemory(
        {
          categories: ['project'],
          layers: [LayersEnum.Activity],
          queries: ['atlas'],
          timeRange: {
            end: new Date('2024-01-31T23:59:59.999Z'),
            field: 'createdAt',
            start: new Date('2024-01-01T00:00:00.000Z'),
          },
          topK: { activities: 3, contexts: 0, experiences: 0, identities: 0, preferences: 0 },
        },
        [[0.1, 0.2, 0.3]],
      );

      expect(semanticSearch).toHaveBeenCalledOnce();
      expect(lexicalSearch).toHaveBeenCalledOnce();
    });

    it('returns full layer payloads for filter-only lexical searches', async () => {
      const tag = 'atlas';

      const { activity } = await createActivityPair({
        notes: 'activity note',
        tags: [tag],
        title: 'Atlas activity',
      });
      const { context } = await createContextPair({
        associatedObjectName: 'Linear',
        associatedSubjectName: 'Alice',
        tags: [tag],
        title: 'Atlas context',
      });
      const { experience } = await createExperiencePair({
        action: 'Investigated incident',
        possibleOutcome: 'Resolved faster next time',
        reasoning: 'Compared multiple logs',
        tags: [tag],
      });
      const { preference } = await createPreferencePair({
        suggestions: 'Summarize with bullets',
        tags: [tag],
      });

      const result = await memoryModel.searchMemory({
        categories: undefined,
        layers: [
          LayersEnum.Activity,
          LayersEnum.Context,
          LayersEnum.Experience,
          LayersEnum.Preference,
        ],
        tags: [tag],
        topK: { activities: 1, contexts: 1, experiences: 1, identities: 0, preferences: 1 },
      });

      expect(result.activities).toHaveLength(1);
      expect(result.activities[0].id).toBe(activity.id);
      expect(result.activities[0].notes).toBe('activity note');

      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].id).toBe(context.id);
      expect(result.contexts[0].associatedObjects).toEqual([
        { name: 'Linear', type: UserMemoryContextObjectType.Application },
      ]);
      expect(result.contexts[0].associatedSubjects).toEqual([{ name: 'Alice', type: 'person' }]);

      expect(result.experiences).toHaveLength(1);
      expect(result.experiences[0].id).toBe(experience.id);
      expect(result.experiences[0].reasoning).toBe('Compared multiple logs');
      expect(result.experiences[0].possibleOutcome).toBe('Resolved faster next time');

      expect(result.preferences).toHaveLength(1);
      expect(result.preferences[0].id).toBe(preference.id);
      expect(result.preferences[0].suggestions).toBe('Summarize with bullets');
    });
  });

  // ========== listMemories ==========
  describe('listMemories', () => {
    it('should list experience memories', async () => {
      await createExperiencePair({});

      const result = await memoryModel.listMemories({ layer: LayersEnum.Experience });

      expect(result).toHaveLength(1);
    });

    it('should list identity memories', async () => {
      await createIdentityPair({});

      const result = await memoryModel.listMemories({ layer: LayersEnum.Identity });

      expect(result).toHaveLength(1);
    });

    it('should list preference memories', async () => {
      await createPreferencePair({});

      const result = await memoryModel.listMemories({ layer: LayersEnum.Preference });

      expect(result).toHaveLength(1);
    });

    it('should list context memories', async () => {
      await createContextPair({});

      const result = await memoryModel.listMemories({ layer: LayersEnum.Context });

      expect(result).toHaveLength(1);
    });

    it('should respect pagination parameters', async () => {
      for (let i = 0; i < 5; i++) {
        await createExperiencePair({});
      }

      const result = await memoryModel.listMemories({
        layer: LayersEnum.Experience,
        pageSize: 2,
      });

      expect(result).toHaveLength(2);
    });

    it('should not return other user memories', async () => {
      await createExperiencePair({});
      await createExperiencePair({ user: otherUserId });

      const result = await memoryModel.listMemories({ layer: LayersEnum.Experience });

      expect(result).toHaveLength(1);
    });
  });

  // ========== getMemoryDetail ==========
  describe('getMemoryDetail', () => {
    it('should get context detail', async () => {
      const { context } = await createContextPair({});

      const result = await memoryModel.getMemoryDetail({
        id: context.id,
        layer: LayersEnum.Context,
      });

      expect(result).toBeDefined();
      if (!result || result.layer !== LayersEnum.Context)
        throw new Error('Expected context detail');
      expect(result.context).toBeDefined();
      expect(result?.memory).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Context);
    });

    it('should get activity detail', async () => {
      const { activity } = await createActivityPair({});

      const result = await memoryModel.getMemoryDetail({
        id: activity.id,
        layer: LayersEnum.Activity,
      });

      expect(result).toBeDefined();
      if (!result || result.layer !== LayersEnum.Activity)
        throw new Error('Expected activity detail');
      expect(result.activity).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Activity);
    });

    it('should get experience detail', async () => {
      const { experience } = await createExperiencePair({});

      const result = await memoryModel.getMemoryDetail({
        id: experience.id,
        layer: LayersEnum.Experience,
      });

      expect(result).toBeDefined();
      if (!result || result.layer !== LayersEnum.Experience)
        throw new Error('Expected experience detail');
      expect(result.experience).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Experience);
    });

    it('should get identity detail', async () => {
      const { identity } = await createIdentityPair({});

      const result = await memoryModel.getMemoryDetail({
        id: identity.id,
        layer: LayersEnum.Identity,
      });

      expect(result).toBeDefined();
      if (!result || result.layer !== LayersEnum.Identity)
        throw new Error('Expected identity detail');
      expect(result.identity).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Identity);
    });

    it('should get preference detail', async () => {
      const { preference } = await createPreferencePair({});

      const result = await memoryModel.getMemoryDetail({
        id: preference.id,
        layer: LayersEnum.Preference,
      });

      expect(result).toBeDefined();
      if (!result || result.layer !== LayersEnum.Preference)
        throw new Error('Expected preference detail');
      expect(result.preference).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Preference);
    });

    it('should return undefined for non-existent id', async () => {
      const result = await memoryModel.getMemoryDetail({
        id: 'non-existent',
        layer: LayersEnum.Context,
      });

      expect(result).toBeUndefined();
    });

    it('should not return other user detail', async () => {
      const { identity } = await createIdentityPair({ user: otherUserId });

      const result = await memoryModel.getMemoryDetail({
        id: identity.id,
        layer: LayersEnum.Identity,
      });

      expect(result).toBeUndefined();
    });
  });

  // ========== searchActivities ==========
  describe('searchActivities', () => {
    it('should return activities for current user (no embedding)', async () => {
      await createActivityPair({ type: 'task' });
      await createActivityPair({ type: 'event' });

      const result = await memoryModel.searchActivities({});

      expect(result).toHaveLength(2);
    });

    it('should filter by type', async () => {
      await createActivityPair({ type: 'task' });
      await createActivityPair({ type: 'event' });

      const result = await memoryModel.searchActivities({ type: 'task' });

      expect(result).toHaveLength(1);
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await createActivityPair({ type: 'task' });
      }

      const result = await memoryModel.searchActivities({ limit: 3 });

      expect(result).toHaveLength(3);
    });

    it('should return empty array for limit <= 0', async () => {
      await createActivityPair({});

      const result = await memoryModel.searchActivities({ limit: 0 });

      expect(result).toEqual([]);
    });

    it('should not return other user activities', async () => {
      await createActivityPair({});
      await createActivityPair({ user: otherUserId });

      const result = await memoryModel.searchActivities({});

      expect(result).toHaveLength(1);
    });
  });

  // ========== searchContexts ==========
  describe('searchContexts', () => {
    it('should return contexts for current user (no embedding)', async () => {
      await createContextPair({});

      const result = await memoryModel.searchContexts({});

      expect(result).toHaveLength(1);
    });

    it('should filter by type', async () => {
      await createContextPair({ type: 'project' });
      await createContextPair({ type: 'meeting' });

      const result = await memoryModel.searchContexts({ type: 'project' });

      expect(result).toHaveLength(1);
    });

    it('should return empty for limit <= 0', async () => {
      await createContextPair({});
      expect(await memoryModel.searchContexts({ limit: 0 })).toEqual([]);
    });
  });

  // ========== searchExperiences ==========
  describe('searchExperiences', () => {
    it('should return experiences for current user', async () => {
      await createExperiencePair({});

      const result = await memoryModel.searchExperiences({});

      expect(result).toHaveLength(1);
    });

    it('should filter by type', async () => {
      await createExperiencePair({ type: 'learning' });
      await createExperiencePair({ type: 'failure' });

      const result = await memoryModel.searchExperiences({ type: 'learning' });

      expect(result).toHaveLength(1);
    });

    it('should return empty for limit <= 0', async () => {
      await createExperiencePair({});
      expect(await memoryModel.searchExperiences({ limit: 0 })).toEqual([]);
    });
  });

  // ========== searchPreferences ==========
  describe('searchPreferences', () => {
    it('should return preferences for current user', async () => {
      await createPreferencePair({});

      const result = await memoryModel.searchPreferences({});

      expect(result).toHaveLength(1);
    });

    it('should filter by type', async () => {
      await createPreferencePair({ type: 'ui' });
      await createPreferencePair({ type: 'language' });

      const result = await memoryModel.searchPreferences({ type: 'ui' });

      expect(result).toHaveLength(1);
    });

    it('should return empty for limit <= 0', async () => {
      await createPreferencePair({});
      expect(await memoryModel.searchPreferences({ limit: 0 })).toEqual([]);
    });
  });

  // ========== updateUserMemoryVectors ==========
  describe('updateUserMemoryVectors', () => {
    it('should update vectors on base memory', async () => {
      const [mem] = await serverDB
        .insert(userMemories)
        .values({
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          title: 'Vector test',
          userId,
        })
        .returning();

      const vector1024 = Array.from({ length: 1024 }, () => Math.random());
      await memoryModel.updateUserMemoryVectors(mem.id, {
        detailsVector1024: vector1024,
        summaryVector1024: vector1024,
      });

      const updated = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, mem.id),
      });
      expect(updated?.detailsVector1024).toBeDefined();
      expect(updated?.summaryVector1024).toBeDefined();
    });

    it('should skip update when no vectors provided', async () => {
      const [mem] = await serverDB
        .insert(userMemories)
        .values({
          lastAccessedAt: new Date(),
          memoryLayer: 'context',
          title: 'No vector test',
          userId,
        })
        .returning();

      const beforeUpdate = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, mem.id),
      });

      await memoryModel.updateUserMemoryVectors(mem.id, {});

      const afterUpdate = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, mem.id),
      });
      expect(afterUpdate?.updatedAt.getTime()).toBe(beforeUpdate?.updatedAt.getTime());
    });
  });

  // ========== updateContextVectors ==========
  describe('updateContextVectors', () => {
    it('should update description vector', async () => {
      const { context } = await createContextPair({});
      const vector1024 = Array.from({ length: 1024 }, () => Math.random());

      await memoryModel.updateContextVectors(context.id, { descriptionVector: vector1024 });

      const updated = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, context.id),
      });
      expect(updated?.descriptionVector).toBeDefined();
    });

    it('should skip when no vectors provided', async () => {
      const { context } = await createContextPair({});

      await memoryModel.updateContextVectors(context.id, {});
      // No error means success
    });
  });

  // ========== updatePreferenceVectors ==========
  describe('updatePreferenceVectors', () => {
    it('should update conclusion directives vector', async () => {
      const { preference } = await createPreferencePair({});
      const vector1024 = Array.from({ length: 1024 }, () => Math.random());

      await memoryModel.updatePreferenceVectors(preference.id, {
        conclusionDirectivesVector: vector1024,
      });

      const updated = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, preference.id),
      });
      expect(updated?.conclusionDirectivesVector).toBeDefined();
    });

    it('should skip when no vectors provided', async () => {
      const { preference } = await createPreferencePair({});
      await memoryModel.updatePreferenceVectors(preference.id, {});
    });
  });

  // ========== updateIdentityVectors ==========
  describe('updateIdentityVectors', () => {
    it('should update description vector', async () => {
      const { identity } = await createIdentityPair({});
      const vector1024 = Array.from({ length: 1024 }, () => Math.random());

      await memoryModel.updateIdentityVectors(identity.id, { descriptionVector: vector1024 });

      const updated = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identity.id),
      });
      expect(updated?.descriptionVector).toBeDefined();
    });

    it('should skip when no vectors provided', async () => {
      const { identity } = await createIdentityPair({});
      await memoryModel.updateIdentityVectors(identity.id, {});
    });
  });

  // ========== updateExperienceVectors ==========
  describe('updateExperienceVectors', () => {
    it('should update multiple vectors', async () => {
      const { experience } = await createExperiencePair({});
      const vector1024 = Array.from({ length: 1024 }, () => Math.random());

      await memoryModel.updateExperienceVectors(experience.id, {
        actionVector: vector1024,
        keyLearningVector: vector1024,
        situationVector: vector1024,
      });

      const updated = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experience.id),
      });
      expect(updated?.actionVector).toBeDefined();
      expect(updated?.keyLearningVector).toBeDefined();
      expect(updated?.situationVector).toBeDefined();
    });

    it('should skip when no vectors provided', async () => {
      const { experience } = await createExperiencePair({});
      await memoryModel.updateExperienceVectors(experience.id, {});
    });
  });

  // ========== updateActivityVectors ==========
  describe('updateActivityVectors', () => {
    it('should update narrative and feedback vectors', async () => {
      const { activity } = await createActivityPair({});
      const vector1024 = Array.from({ length: 1024 }, () => Math.random());

      await memoryModel.updateActivityVectors(activity.id, {
        feedbackVector: vector1024,
        narrativeVector: vector1024,
      });

      const updated = await serverDB.query.userMemoriesActivities.findFirst({
        where: eq(userMemoriesActivities.id, activity.id),
      });
      expect(updated?.narrativeVector).toBeDefined();
      expect(updated?.feedbackVector).toBeDefined();
    });

    it('should skip when no vectors provided', async () => {
      const { activity } = await createActivityPair({});
      await memoryModel.updateActivityVectors(activity.id, {});
    });
  });

  // ========== addIdentityEntry ==========
  describe('addIdentityEntry', () => {
    it('should create both base memory and identity in transaction', async () => {
      const result = await memoryModel.addIdentityEntry({
        base: {
          details: 'I am a developer',
          summary: 'Developer identity',
          title: 'Developer',
        },
        identity: {
          description: 'Software developer',
          relationship: RelationshipEnum.Self,
          role: 'developer',
          type: IdentityTypeEnum.Personal,
        },
      });

      expect(result.identityId).toBeDefined();
      expect(result.userMemoryId).toBeDefined();

      const mem = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, result.userMemoryId),
      });
      expect(mem?.userId).toBe(userId);
      expect(mem?.memoryLayer).toBe('identity');

      const identity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, result.identityId),
      });
      expect(identity?.role).toBe('developer');
      expect(identity?.userMemoryId).toBe(result.userMemoryId);
    });

    it('should handle empty params with defaults', async () => {
      const result = await memoryModel.addIdentityEntry({
        base: {},
        identity: {},
      });

      expect(result.identityId).toBeDefined();
      expect(result.userMemoryId).toBeDefined();
    });

    it('should normalize relationship and type values', async () => {
      const result = await memoryModel.addIdentityEntry({
        base: {},
        identity: {
          relationship: ' Self ',
          type: ' Personal ',
        },
      });

      const identity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, result.identityId),
      });
      expect(identity?.relationship).toBe(RelationshipEnum.Self);
      expect(identity?.type).toBe(IdentityTypeEnum.Personal);
    });
  });

  // ========== updateIdentityEntry ==========
  describe('updateIdentityEntry', () => {
    it('should update identity and base memory', async () => {
      const { identityId, userMemoryId } = await memoryModel.addIdentityEntry({
        base: { title: 'Original' },
        identity: { role: 'original' },
      });

      const success = await memoryModel.updateIdentityEntry({
        base: { title: 'Updated' },
        identity: { role: 'updated' },
        identityId,
      });

      expect(success).toBe(true);

      const mem = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      expect(mem?.title).toBe('Updated');

      const identity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });
      expect(identity?.role).toBe('updated');
    });

    it('should return false for non-existent identity', async () => {
      const success = await memoryModel.updateIdentityEntry({
        identity: { role: 'test' },
        identityId: 'non-existent',
      });

      expect(success).toBe(false);
    });

    it('should support replace merge strategy', async () => {
      const { identityId } = await memoryModel.addIdentityEntry({
        base: {},
        identity: {
          description: 'original desc',
          role: 'original role',
          type: IdentityTypeEnum.Personal,
        },
      });

      const success = await memoryModel.updateIdentityEntry({
        identity: { description: 'replaced desc' },
        identityId,
        mergeStrategy: MergeStrategyEnum.Replace,
      });

      expect(success).toBe(true);
      const updated = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });
      expect(updated?.description).toBe('replaced desc');
      // In replace mode, unspecified fields become null
      expect(updated?.role).toBeNull();
    });

    it('should not update other user identity', async () => {
      const otherModel = new UserMemoryModel(serverDB, otherUserId);
      const { identityId } = await otherModel.addIdentityEntry({
        base: {},
        identity: { role: 'other-role' },
      });

      const success = await memoryModel.updateIdentityEntry({
        identity: { role: 'hacked' },
        identityId,
      });

      expect(success).toBe(false);
    });
  });

  // ========== removeIdentityEntry ==========
  describe('removeIdentityEntry', () => {
    it('should delete identity and associated base memory', async () => {
      const { identityId, userMemoryId } = await memoryModel.addIdentityEntry({
        base: { title: 'To delete' },
        identity: { role: 'disposable' },
      });

      const success = await memoryModel.removeIdentityEntry(identityId);

      expect(success).toBe(true);

      const identity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });
      expect(identity).toBeUndefined();

      const mem = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      expect(mem).toBeUndefined();
    });

    it('should return false for non-existent identity', async () => {
      const success = await memoryModel.removeIdentityEntry('non-existent');
      expect(success).toBe(false);
    });

    it('should not delete other user identity', async () => {
      const otherModel = new UserMemoryModel(serverDB, otherUserId);
      const { identityId } = await otherModel.addIdentityEntry({
        base: {},
        identity: { role: 'other' },
      });

      const success = await memoryModel.removeIdentityEntry(identityId);
      expect(success).toBe(false);
    });
  });

  // ========== getAllIdentities ==========
  describe('getAllIdentities', () => {
    it('should return all identities for current user', async () => {
      await createIdentityPair({ type: 'personal' });
      await createIdentityPair({ type: 'professional' });
      await createIdentityPair({ type: 'other', user: otherUserId });

      const result = await memoryModel.getAllIdentities();

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.userId === userId)).toBe(true);
    });

    it('should order by capturedAt descending', async () => {
      await createIdentityPair({ type: 'first' });
      // Small delay to ensure different timestamps
      await createIdentityPair({ type: 'second' });

      const result = await memoryModel.getAllIdentities();

      expect(result).toHaveLength(2);
      // Most recent first
      expect(result[0].createdAt.getTime()).toBeGreaterThanOrEqual(result[1].createdAt.getTime());
    });

    it('should return empty array when no identities', async () => {
      const result = await memoryModel.getAllIdentities();
      expect(result).toEqual([]);
    });
  });

  // ========== getAllIdentitiesWithMemory ==========
  describe('getAllIdentitiesWithMemory', () => {
    it('should return identities joined with base memories', async () => {
      await createIdentityPair({ baseTitle: 'My identity memory' });

      const result = await memoryModel.getAllIdentitiesWithMemory();

      expect(result).toHaveLength(1);
      expect(result[0].identity).toBeDefined();
      expect(result[0].memory).toBeDefined();
      expect(result[0].memory.title).toBe('My identity memory');
    });

    it('should not return other user data', async () => {
      await createIdentityPair({});
      await createIdentityPair({ user: otherUserId });

      const result = await memoryModel.getAllIdentitiesWithMemory();

      expect(result).toHaveLength(1);
    });
  });

  // ========== getIdentitiesByType ==========
  describe('getIdentitiesByType', () => {
    it('should filter identities by type', async () => {
      await createIdentityPair({ type: 'personal' });
      await createIdentityPair({ type: 'professional' });
      await createIdentityPair({ type: 'personal' });

      const result = await memoryModel.getIdentitiesByType('personal');

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.type === 'personal')).toBe(true);
    });

    it('should return empty array for non-matching type', async () => {
      await createIdentityPair({ type: 'personal' });

      const result = await memoryModel.getIdentitiesByType('unknown');

      expect(result).toEqual([]);
    });

    it('should not return other user identities', async () => {
      await createIdentityPair({ type: 'personal' });
      await createIdentityPair({ type: 'personal', user: otherUserId });

      const result = await memoryModel.getIdentitiesByType('personal');

      expect(result).toHaveLength(1);
    });
  });

  // ========== removeContextEntry ==========
  describe('removeContextEntry', () => {
    it('should delete context and associated memories', async () => {
      const { context, memory } = await createContextPair({});

      const success = await memoryModel.removeContextEntry(context.id);

      expect(success).toBe(true);

      const ctx = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, context.id),
      });
      expect(ctx).toBeUndefined();

      const mem = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });
      expect(mem).toBeUndefined();
    });

    it('should return false for non-existent context', async () => {
      const success = await memoryModel.removeContextEntry('non-existent');
      expect(success).toBe(false);
    });
  });

  // ========== removeExperienceEntry ==========
  describe('removeExperienceEntry', () => {
    it('should delete experience and associated base memory', async () => {
      const { experience, memory } = await createExperiencePair({});

      const success = await memoryModel.removeExperienceEntry(experience.id);

      expect(success).toBe(true);

      const exp = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experience.id),
      });
      expect(exp).toBeUndefined();
    });

    it('should return false for non-existent experience', async () => {
      const success = await memoryModel.removeExperienceEntry('non-existent');
      expect(success).toBe(false);
    });
  });

  // ========== removePreferenceEntry ==========
  describe('removePreferenceEntry', () => {
    it('should delete preference and associated base memory', async () => {
      const { preference } = await createPreferencePair({});

      const success = await memoryModel.removePreferenceEntry(preference.id);

      expect(success).toBe(true);

      const pref = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, preference.id),
      });
      expect(pref).toBeUndefined();
    });

    it('should return false for non-existent preference', async () => {
      const success = await memoryModel.removePreferenceEntry('non-existent');
      expect(success).toBe(false);
    });
  });

  // ========== Create Memory Methods (model-level) ==========
  describe('createActivityMemory', () => {
    it('should create activity memory via model', async () => {
      const result = await memoryModel.createActivityMemory({
        details: 'Activity details',
        memoryLayer: LayersEnum.Activity,
        memoryType: TypesEnum.Activity,
        summary: 'Activity summary',
        title: 'Activity test',
        activity: {
          associatedLocations: null,
          associatedObjects: [],
          associatedSubjects: [],
          feedback: null,
          feedbackVector: null,
          metadata: null,
          narrative: 'Did a thing',
          narrativeVector: null,
          notes: null,
          status: 'completed',
          endsAt: new Date('2025-01-02'),
          startsAt: new Date('2025-01-01'),
          tags: ['test-tag'],
          timezone: null,
          type: ActivityTypeEnum.Other,
        },
      });

      expect(result.memory).toBeDefined();
      expect(result.memory.memoryLayer).toBe(LayersEnum.Activity);
      expect(result.activity).toBeDefined();
      expect(result.activity.narrative).toBe('Did a thing');
      expect(result.activity.userMemoryId).toBe(result.memory.id);
    });
  });

  describe('createExperienceMemory', () => {
    it('should create experience memory via model', async () => {
      const result = await memoryModel.createExperienceMemory({
        details: 'Experience details',
        memoryLayer: LayersEnum.Experience,
        memoryType: TypesEnum.Other,
        summary: 'Experience summary',
        title: 'Experience test',
        experience: {
          action: 'learned something',
          actionVector: null,
          keyLearning: 'important lesson',
          keyLearningVector: null,
          metadata: null,
          possibleOutcome: 'better outcomes',
          reasoning: 'because reasons',
          scoreConfidence: null,
          situation: 'at work',
          situationVector: null,
          tags: ['learn'],
          type: 'learning',
        },
      });

      expect(result.memory).toBeDefined();
      expect(result.memory.memoryLayer).toBe(LayersEnum.Experience);
      expect(result.experience).toBeDefined();
      expect(result.experience.action).toBe('learned something');
      expect(result.experience.userMemoryId).toBe(result.memory.id);
    });
  });

  describe('createContextMemory', () => {
    it('should create context memory via model', async () => {
      const result = await memoryModel.createContextMemory({
        details: 'Context details',
        memoryLayer: LayersEnum.Context,
        memoryType: TypesEnum.Context,
        summary: 'Context summary',
        title: 'Context test',
        context: {
          associatedObjects: [],
          associatedSubjects: [],
          currentStatus: null,
          description: 'A test context',
          descriptionVector: null,
          metadata: null,
          scoreImpact: null,
          scoreUrgency: null,
          title: 'Test Context',
          tags: ['ctx-tag'],
          type: 'project',
        },
      });

      expect(result.memory).toBeDefined();
      expect(result.memory.memoryLayer).toBe(LayersEnum.Context);
      expect(result.context).toBeDefined();
      expect(result.context.description).toBe('A test context');
    });
  });

  describe('createPreferenceMemory', () => {
    it('should create preference memory via model', async () => {
      const capturedAt = new Date('2025-01-03T00:00:00.000Z');

      const result = await memoryModel.createPreferenceMemory({
        details: 'Preference details',
        memoryLayer: LayersEnum.Preference,
        memoryType: TypesEnum.Other,
        summary: 'Preference summary',
        title: 'Preference test',
        preference: {
          capturedAt,
          conclusionDirectives: 'Use compact cards',
          conclusionDirectivesVector: Array.from({ length: 1024 }, (_, index) =>
            index === 0 ? 1 : 0,
          ),
          metadata: { source: 'unit-test' },
          scorePriority: 0.8,
          suggestions: 'Prefer short answers',
          tags: ['ui', 'tone'],
          type: null,
        },
      });

      expect(result.memory).toBeDefined();
      expect(result.memory.memoryLayer).toBe(LayersEnum.Preference);
      expect(result.memory.metadata).toEqual({ source: 'unit-test' });
      expect(result.preference).toBeDefined();
      expect(result.preference.capturedAt).toEqual(capturedAt);
      expect(result.preference.type).toBe(TypesEnum.Other);
      expect(result.preference.userMemoryId).toBe(result.memory.id);
    });
  });

  describe('search access metrics', () => {
    it('should update access metrics for returned activities, contexts, experiences, and preferences', async () => {
      const now = new Date('2025-01-04T00:00:00.000Z');
      const { activity, memory: activityMemory } = await createActivityPair({
        tags: ['activity-tag'],
      });
      const { context } = await createContextPair({ tags: ['context-tag'] });
      const { experience, memory: experienceMemory } = await createExperiencePair({
        tags: ['experience-tag'],
      });
      const { memory: preferenceMemory, preference } = await createPreferencePair({
        tags: ['preference-tag'],
      });

      const result = await memoryModel.search({
        limits: {
          activities: 1,
          contexts: 1,
          experiences: 1,
          preferences: 1,
        },
      });

      expect(result.activities).toHaveLength(1);
      expect(result.contexts).toHaveLength(1);
      expect(result.experiences).toHaveLength(1);
      expect(result.preferences).toHaveLength(1);

      const updatedActivityMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, activityMemory.id),
      });
      const updatedExperienceMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, experienceMemory.id),
      });
      const updatedPreferenceMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, preferenceMemory.id),
      });
      const updatedActivity = await serverDB.query.userMemoriesActivities.findFirst({
        where: eq(userMemoriesActivities.id, activity.id),
      });
      const updatedContext = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, context.id),
      });
      const updatedExperience = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experience.id),
      });
      const updatedPreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, preference.id),
      });

      expect(updatedActivityMemory?.accessedCount).toBe(1);
      expect(updatedActivityMemory?.lastAccessedAt).toBeInstanceOf(Date);
      expect(updatedExperienceMemory?.accessedCount).toBe(1);
      expect(updatedPreferenceMemory?.accessedCount).toBe(1);
      expect(updatedActivity?.accessedAt).toBeInstanceOf(Date);
      expect(updatedContext?.accessedAt).toBeInstanceOf(Date);
      expect(updatedExperience?.accessedAt).toBeInstanceOf(Date);
      expect(updatedPreference?.accessedAt).toBeInstanceOf(Date);
      expect(updatedActivity?.accessedAt?.getTime()).toBeGreaterThanOrEqual(now.getTime() - 60_000);
    });

    it('should delegate searchWithEmbedding to search', async () => {
      const searchSpy = vi.spyOn(memoryModel, 'search');

      const result = await memoryModel.searchWithEmbedding({
        embedding: [0.1, 0.2],
        limits: { activities: 2 },
      });

      expect(searchSpy).toHaveBeenCalledWith({
        embedding: [0.1, 0.2],
        limits: { activities: 2 },
      });
      expect(result).toEqual(await searchSpy.mock.results[0]!.value);
    });
  });

  describe('wrapper methods', () => {
    it('should delegate queryTaxonomyOptions to the query model', async () => {
      const mockedResult = {
        activityTypes: ['task'],
        categories: ['productivity'],
        contextTypes: ['project'],
        identityTypes: ['personal'],
        preferenceTypes: ['ui'],
      };
      const params = {
        include: ['categories'],
        q: 'productivity',
      };
      const querySpy = vi
        .spyOn((memoryModel as any).queryModel, 'queryTaxonomyOptions')
        .mockResolvedValue(mockedResult);

      const result = await memoryModel.queryTaxonomyOptions(params);

      expect(querySpy).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockedResult);
    });
  });

  describe('findById', () => {
    it('should update access metrics for identity memories when a memory is found', async () => {
      const { identity, memory } = await createIdentityPair({});

      const found = await memoryModel.findById(memory.id);

      expect(found?.id).toBe(memory.id);

      const updatedMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });
      const updatedIdentity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identity.id),
      });

      expect(updatedMemory?.accessedCount).toBe(1);
      expect(updatedMemory?.lastAccessedAt).toBeInstanceOf(Date);
      expect(updatedIdentity?.accessedAt).toBeInstanceOf(Date);
    });

    it('should return undefined for a missing memory id', async () => {
      const found = await memoryModel.findById('missing-memory-id');

      expect(found).toBeUndefined();
    });
  });

  describe('base memory CRUD methods', () => {
    it('should update a base memory for the current user', async () => {
      const { memory } = await createExperiencePair();

      await memoryModel.update(memory.id, {
        details: 'updated details',
        summary: 'updated summary',
        title: 'updated title',
      });

      const updated = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });

      expect(updated?.details).toBe('updated details');
      expect(updated?.summary).toBe('updated summary');
      expect(updated?.title).toBe('updated title');
    });

    it('should delete only the current user memory', async () => {
      const { memory } = await createExperiencePair();
      const { memory: otherMemory } = await createExperiencePair({ user: otherUserId });

      await memoryModel.delete(memory.id);

      const deleted = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });
      const kept = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, otherMemory.id),
      });

      expect(deleted).toBeUndefined();
      expect(kept).toBeDefined();
    });

    it('should delete all memories for the current user only', async () => {
      await createActivityPair();
      await createContextPair();
      await createExperiencePair();
      await createPreferencePair();
      await createIdentityPair({ user: otherUserId });

      await memoryModel.deleteAll();

      const currentUserMemories = await serverDB.query.userMemories.findMany({
        where: eq(userMemories.userId, userId),
      });
      const otherUserMemories = await serverDB.query.userMemories.findMany({
        where: eq(userMemories.userId, otherUserId),
      });

      expect(currentUserMemories).toHaveLength(0);
      expect(otherUserMemories).toHaveLength(1);
    });
  });

  // ========== parseAssociatedObjects with valid schema ==========
  describe('parseAssociatedObjects - valid AssociatedObjectSchema', () => {
    it('should parse valid associated objects with extra', () => {
      const result = UserMemoryModel.parseAssociatedObjects([
        {
          name: 'TestObj',
          type: UserMemoryContextObjectType.Application,
          extra: '{"key":"value"}',
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'TestObj',
        type: UserMemoryContextObjectType.Application,
        extra: { key: 'value' },
      });
    });

    it('should parse valid objects with null extra', () => {
      const result = UserMemoryModel.parseAssociatedObjects([
        {
          name: 'TestObj',
          type: UserMemoryContextObjectType.Person,
          extra: null,
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'TestObj',
        type: UserMemoryContextObjectType.Person,
      });
    });

    it('should not throw on non-JSON extra and preserve raw text', () => {
      const result = UserMemoryModel.parseAssociatedObjects([
        {
          name: 'Policy Doc',
          type: UserMemoryContextObjectType.Other,
          extra: 'plain text metadata note',
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        extra: { raw: 'plain text metadata note' },
        name: 'Policy Doc',
        type: UserMemoryContextObjectType.Other,
      });
    });
  });

  describe('parseAssociatedSubjects - valid schema', () => {
    it('should parse valid associated subjects with extra', () => {
      // UserMemoryContextSubjectType has: Item, Other, Person, Pet
      const result = UserMemoryModel.parseAssociatedSubjects([
        {
          name: 'TestSubject',
          type: 'person', // lowercase matches nativeEnum
          extra: '{"role":"admin"}',
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'TestSubject',
        extra: { role: 'admin' },
      });
    });

    it('should not throw on plain text subject extra', () => {
      const result = UserMemoryModel.parseAssociatedSubjects([
        {
          name: 'Runtime Agent',
          type: 'person',
          extra: 'subject plain text metadata',
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        extra: { raw: 'subject plain text metadata' },
        name: 'Runtime Agent',
      });
    });
  });

  // ========== getMemoryDetail edge cases ==========
  describe('getMemoryDetail - edge cases', () => {
    it('should return undefined for context with no userMemoryIds', async () => {
      // Create a context with empty userMemoryIds
      const [ctx] = await serverDB
        .insert(userMemoriesContexts)
        .values({
          description: 'No memory',
          title: 'Empty context',
          type: 'project',
          userId,
          userMemoryIds: [],
        })
        .returning();

      const result = await memoryModel.getMemoryDetail({
        id: ctx.id,
        layer: LayersEnum.Context,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined for activity with no userMemoryId', async () => {
      // Create an activity without a linked memory
      const [act] = await serverDB
        .insert(userMemoriesActivities)
        .values({
          narrative: 'orphan',
          status: 'pending',
          type: ActivityTypeEnum.Other,
          userId,
        })
        .returning();

      const result = await memoryModel.getMemoryDetail({
        id: act.id,
        layer: LayersEnum.Activity,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined for experience with no userMemoryId', async () => {
      const [exp] = await serverDB
        .insert(userMemoriesExperiences)
        .values({
          action: 'orphan',
          situation: 'test',
          type: 'learning',
          userId,
        })
        .returning();

      const result = await memoryModel.getMemoryDetail({
        id: exp.id,
        layer: LayersEnum.Experience,
      });

      expect(result).toBeUndefined();
    });
  });

  // ========== queryMemories with tags filter ==========
  describe('queryMemories - tags filter', () => {
    it('should filter activities by tags', async () => {
      await createActivityPair({ tags: ['urgent'] });
      await createActivityPair({ tags: ['low-priority'] });

      const result = await memoryModel.queryMemories({
        layer: LayersEnum.Activity,
        tags: ['urgent'],
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter contexts by tags', async () => {
      await createContextPair({ tags: ['work'] });
      await createContextPair({ tags: ['personal'] });

      const result = await memoryModel.queryMemories({
        layer: LayersEnum.Context,
        tags: ['work'],
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========== updateIdentityEntry with capturedAt ==========
  describe('updateIdentityEntry - capturedAt', () => {
    it('should update capturedAt on identity', async () => {
      const { identity, memory } = await createIdentityPair({});
      const capturedDate = new Date('2025-06-15T12:00:00Z');

      const result = await memoryModel.updateIdentityEntry({
        identityId: identity.id,
        identity: {
          capturedAt: capturedDate,
        },
      });

      expect(result).toBe(true);

      const updated = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identity.id),
      });
      expect(updated?.capturedAt).toEqual(capturedDate);
    });
  });
});
