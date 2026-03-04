// @vitest-environment node
import {
  ActivityTypeEnum,
  IdentityTypeEnum,
  LayersEnum,
  RelationshipEnum,
  UserMemoryContextObjectType,
} from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

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
  status?: string;
  tags?: string[];
  type?: string;
  user?: string;
}) {
  const uid = opts?.user ?? userId;
  const [mem] = await serverDB
    .insert(userMemories)
    .values({
      details: 'activity details',
      lastAccessedAt: new Date(),
      memoryLayer: 'activity',
      memoryType: 'activity',
      summary: 'activity summary',
      tags: opts?.tags,
      title: 'Activity memory',
      userId: uid,
    })
    .returning();

  const [act] = await serverDB
    .insert(userMemoriesActivities)
    .values({
      narrative: 'did a thing',
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
      const result = UserMemoryModel.parseAssociatedLocations({ name: 'Office' } as any);
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
      const result = UserMemoryModel.parseAssociatedLocations([{ invalid: true } as any]);
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
      expect(UserMemoryModel.parseDateFromString(42 as any)).toBeNull();
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

      it('should filter by text query', async () => {
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
          layer: 'unknown-layer' as any,
        });

        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });
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
      expect((result as any)?.context).toBeDefined();
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
      expect((result as any)?.activity).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Activity);
    });

    it('should get experience detail', async () => {
      const { experience } = await createExperiencePair({});

      const result = await memoryModel.getMemoryDetail({
        id: experience.id,
        layer: LayersEnum.Experience,
      });

      expect(result).toBeDefined();
      expect((result as any)?.experience).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Experience);
    });

    it('should get identity detail', async () => {
      const { identity } = await createIdentityPair({});

      const result = await memoryModel.getMemoryDetail({
        id: identity.id,
        layer: LayersEnum.Identity,
      });

      expect(result).toBeDefined();
      expect((result as any)?.identity).toBeDefined();
      expect(result?.layer).toBe(LayersEnum.Identity);
    });

    it('should get preference detail', async () => {
      const { preference } = await createPreferencePair({});

      const result = await memoryModel.getMemoryDetail({
        id: preference.id,
        layer: LayersEnum.Preference,
      });

      expect(result).toBeDefined();
      expect((result as any)?.preference).toBeDefined();
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
        mergeStrategy: 'replace' as any,
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
      expect((result[0] as any).capturedAt.getTime()).toBeGreaterThanOrEqual(
        (result[1] as any).capturedAt.getTime(),
      );
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
        memoryType: 'activity' as any,
        summary: 'Activity summary',
        title: 'Activity test',
        activity: {
          narrative: 'Did a thing',
          status: 'completed',
          type: ActivityTypeEnum.Other,
          tags: ['test-tag'],
          startsAt: new Date('2025-01-01'),
          endsAt: new Date('2025-01-02'),
        } as any,
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
        memoryType: 'experience' as any,
        summary: 'Experience summary',
        title: 'Experience test',
        experience: {
          action: 'learned something',
          keyLearning: 'important lesson',
          situation: 'at work',
          type: 'learning',
          tags: ['learn'],
          reasoning: 'because reasons',
          possibleOutcome: 'better outcomes',
        } as any,
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
        memoryType: 'context' as any,
        summary: 'Context summary',
        title: 'Context test',
        context: {
          description: 'A test context',
          title: 'Test Context',
          type: 'project',
          tags: ['ctx-tag'],
          associatedObjects: [],
          associatedSubjects: [],
        } as any,
      });

      expect(result.memory).toBeDefined();
      expect(result.memory.memoryLayer).toBe(LayersEnum.Context);
      expect(result.context).toBeDefined();
      expect(result.context.description).toBe('A test context');
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
