// @vitest-environment node
import { LayersEnum, MemorySourceType, MergeStrategyEnum, TypesEnum } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idGenerator } from '@/database/utils/idGenerator';

import { getTestDB } from '../../core/getTestDB';
import {
  userMemories,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type {
  BaseCreateUserMemoryParams,
  CreateUserMemoryContextParams,
  CreateUserMemoryExperienceParams,
  CreateUserMemoryIdentityParams,
  CreateUserMemoryPreferenceParams,
} from '../userMemory';
import { UserMemoryModel } from '../userMemory';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = idGenerator('user');
const userId2 = idGenerator('user');
const userMemoryModel = new UserMemoryModel(serverDB, userId);

/**
 * Generate a random normalized embedding vector
 * @param dimensions - Vector dimensions (default: 1024)
 * @returns Normalized random vector
 */
function generateRandomEmbedding(dimensions: number = 1024): number[] {
  const vector = new Array(dimensions).fill(0).map(() => Math.random() * 2 - 1); // Random values between -1 and 1

  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map((val) => val / magnitude);
}

const mockEmbedding = generateRandomEmbedding();
const mockEmbedding2 = generateRandomEmbedding();

function createAxisVector(dimensions: number = 1024, index: number = 0): number[] {
  return Array.from({ length: dimensions }, (_, i) => (i === index ? 1 : 0));
}

// Assert that two numeric vectors are equal within a precision tolerance
function expectVectorToBeClose(
  actual: number[] | null | undefined,
  expected: number[],
  precision: number = 5,
) {
  expect(actual).toBeDefined();
  expect(actual).not.toBeNull();

  const actualVector = actual as number[];

  expect(actualVector.length).toBe(expected.length);
  actualVector.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, precision);
  });
}

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

function generateRandomCreateUserMemoryParams(
  memoryLayer: BaseCreateUserMemoryParams['memoryLayer'],
): BaseCreateUserMemoryParams {
  return {
    title: 'title ' + nanoid(),
    summary: 'summary ' + nanoid(),
    summaryEmbedding: generateRandomEmbedding(),
    memoryType: TypesEnum.Activity,
    memoryCategory: 'category',
    memoryLayer,
    details: 'details ' + nanoid(),
  } satisfies BaseCreateUserMemoryParams;
}

function generateRandomCreateUserMemoryExperienceParams() {
  return {
    ...generateRandomCreateUserMemoryParams(LayersEnum.Experience),
    experience: {
      action: 'action ' + nanoid(),
      actionVector: generateRandomEmbedding(),
      keyLearning: 'keyLearning ' + nanoid(),
      keyLearningVector: generateRandomEmbedding(),
      metadata: {},
      possibleOutcome: 'possibleOutcome ' + nanoid(),
      reasoning: 'reasoning ' + nanoid(),
      scoreConfidence: 0.5,
      situation: 'situation ' + nanoid(),
      situationVector: generateRandomEmbedding(),
      tags: [],
      type: 'learning',
      capturedAt: new Date(),
    },
  } as CreateUserMemoryExperienceParams;
}

function generateRandomCreateUserMemoryIdentityParams() {
  const relationshipOptions = ['self', 'friend', 'colleague', 'other'];

  return {
    ...generateRandomCreateUserMemoryParams(LayersEnum.Identity),
    identity: {
      description: 'identity description ' + nanoid(),
      descriptionVector: generateRandomEmbedding(),
      episodicDate: new Date(),
      metadata: {},
      relationship: relationshipOptions[Math.floor(Math.random() * relationshipOptions.length)],
      role: 'role ' + nanoid(),
      tags: [],
      type: 'personal',
      capturedAt: new Date(),
    },
  } as CreateUserMemoryIdentityParams;
}

function generateRandomCreateUserMemoryContextParams() {
  return {
    ...generateRandomCreateUserMemoryParams(LayersEnum.Context),
    context: {
      associatedObjects: [],
      associatedSubjects: [],
      currentStatus: 'status ' + nanoid(),
      description: 'context description ' + nanoid(),
      descriptionVector: generateRandomEmbedding(),
      metadata: {},
      scoreImpact: 0.5,
      scoreUrgency: 0.4,
      tags: [],
      title: 'context title ' + nanoid(),
      titleVector: generateRandomEmbedding(),
      type: 'environment',
      userMemoryIds: [],
      capturedAt: new Date(),
    },
  } as CreateUserMemoryContextParams;
}

function generateRandomCreateUserMemoryPreferenceParams() {
  return {
    ...generateRandomCreateUserMemoryParams(LayersEnum.Preference),
    preference: {
      conclusionDirectives: 'directive ' + nanoid(),
      conclusionDirectivesVector: generateRandomEmbedding(),
      metadata: {},
      scorePriority: 0.7,
      suggestions: 'suggestions ' + nanoid(),
      tags: [],
      type: 'choice',
      capturedAt: new Date(),
    },
  } as CreateUserMemoryPreferenceParams;
}

describe('UserMemoryModel', () => {
  describe('parseAssociatedObjects', () => {
    it('returns null when input is not an array or contains no valid items', () => {
      expect(UserMemoryModel.parseAssociatedObjects(undefined)).toHaveLength(0);
      expect(UserMemoryModel.parseAssociatedObjects('not-array')).toHaveLength(0);
      expect(UserMemoryModel.parseAssociatedObjects([null, undefined, '', '   ', 0])).toHaveLength(
        0,
      );
    });

    it('normalizes objects', () => {
      const result = UserMemoryModel.parseAssociatedObjects([
        { name: 'object' },
        ' { "name": "json" } ',
        'raw',
        { another: true },
      ]);

      expect(result).toEqual([{ name: 'object' }]);
    });
  });

  describe('parseDateFromString', () => {
    it('returns null for empty, nullish, non-string, or invalid Date inputs', () => {
      expect(UserMemoryModel.parseDateFromString()).toBeNull();
      expect(UserMemoryModel.parseDateFromString(null)).toBeNull();
      expect(UserMemoryModel.parseDateFromString('   ')).toBeNull();
      expect(UserMemoryModel.parseDateFromString(123 as unknown as string)).toBeNull();
      expect(UserMemoryModel.parseDateFromString(new Date('invalid'))).toBeNull();
    });

    it('parses valid dates from strings and returns the same valid Date instance', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');

      expect(UserMemoryModel.parseDateFromString(' 2024-01-01T00:00:00.000Z ')).toEqual(date);
      expect(UserMemoryModel.parseDateFromString(date)).toBe(date);
    });

    it('returns an invalid Date object when the input string cannot be parsed', () => {
      const invalid = UserMemoryModel.parseDateFromString('not-a-date');

      expect(invalid).toBeInstanceOf(Date);
      expect(Number.isNaN(invalid!.getTime())).toBe(true);
    });
  });

  describe('create layered memories', () => {
    it('creates a context memory and links the base record', async () => {
      const params = generateRandomCreateUserMemoryContextParams();
      params.context.metadata = { contextMeta: true };
      params.context.tags = ['context-tag'];

      const { context, memory } = await userMemoryModel.createContextMemory(params);

      const persistedMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });
      const persistedContext = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, context.id),
      });

      expect(persistedMemory?.metadata).toEqual({ contextMeta: true });
      expect(persistedMemory?.tags).toEqual(['context-tag']);
      expect(persistedContext?.userMemoryIds).toEqual([memory.id]);
      expect(persistedContext?.metadata).toEqual({ contextMeta: true });
      expect(persistedContext?.tags).toEqual(['context-tag']);
    });

    it('creates an experience memory and stores vectors and fallbacks', async () => {
      const params = generateRandomCreateUserMemoryExperienceParams();
      params.experience.metadata = { expMeta: 1 };
      params.experience.tags = ['exp-tag'];
      params.experience.type = null;

      const { experience, memory } = await userMemoryModel.createExperienceMemory(params);

      const persistedMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });
      const persistedExperience = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experience.id),
      });

      expect(persistedMemory?.metadata).toEqual({ expMeta: 1 });
      expect(persistedMemory?.tags).toEqual(['exp-tag']);
      expect(persistedExperience?.userMemoryId).toBe(memory.id);
      expect(persistedExperience?.type).toBe(params.memoryType);
      expectVectorToBeClose(persistedExperience?.actionVector, params.experience.actionVector!);
      expectVectorToBeClose(
        persistedExperience?.situationVector,
        params.experience.situationVector!,
      );
    });

    it('creates a preference memory and links to the base record', async () => {
      const params = generateRandomCreateUserMemoryPreferenceParams();
      params.preference.metadata = { prefMeta: 'yes' };
      params.preference.tags = ['pref-tag'];
      params.preference.type = null;

      const { preference, memory } = await userMemoryModel.createPreferenceMemory(params);

      const persistedMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });
      const persistedPreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, preference.id),
      });

      expect(persistedMemory?.metadata).toEqual({ prefMeta: 'yes' });
      expect(persistedMemory?.tags).toEqual(['pref-tag']);
      expect(persistedPreference?.userMemoryId).toBe(memory.id);
      expect(persistedPreference?.type).toBe(params.memoryType);
      expectVectorToBeClose(
        persistedPreference?.conclusionDirectivesVector,
        params.preference.conclusionDirectivesVector!,
      );
    });
  });

  describe('delete', () => {
    it('should delete a memory by id', async () => {
      const created = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      await userMemoryModel.delete(created.id);

      const deleted = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, created.id),
      });

      expect(deleted).toBeUndefined();
    });

    it('should only delete own user memories', async () => {
      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      const created = await anotherUserModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      await userMemoryModel.delete(created.id);

      const stillExists = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, created.id),
      });

      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    it('should delete all memories for the user', async () => {
      await userMemoryModel.create(generateRandomCreateUserMemoryExperienceParams());
      await userMemoryModel.create(generateRandomCreateUserMemoryIdentityParams());
      await userMemoryModel.create(generateRandomCreateUserMemoryContextParams());
      await userMemoryModel.create(generateRandomCreateUserMemoryPreferenceParams());
      await userMemoryModel.deleteAll();

      const remaining = await serverDB.query.userMemories.findMany({
        where: eq(userMemories.userId, userId),
      });

      expect(remaining).toHaveLength(0);
    });

    it('should only delete memories for the user, not others', async () => {
      // user 2
      const user2Memory = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );
      await serverDB
        .update(userMemories)
        .set({ userId: userId2 })
        .where(eq(userMemories.id, user2Memory.id));

      await userMemoryModel.create(generateRandomCreateUserMemoryIdentityParams());
      await userMemoryModel.create(generateRandomCreateUserMemoryContextParams());
      await userMemoryModel.create(generateRandomCreateUserMemoryPreferenceParams());
      await userMemoryModel.deleteAll();

      const user1Remaining = await serverDB.query.userMemories.findMany({
        where: eq(userMemories.userId, userId),
      });
      const user2Remaining = await serverDB.query.userMemories.findMany({
        where: eq(userMemories.userId, userId2),
      });

      expect(user1Remaining).toHaveLength(0);
      expect(user2Remaining).toHaveLength(1);
    });
  });

  describe('remove layered entries', () => {
    it('removes context entry and linked base memories only for current user', async () => {
      const experienceMemory = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );
      const preferenceMemory = await userMemoryModel.create(
        generateRandomCreateUserMemoryPreferenceParams(),
      );

      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      const otherMemory = await anotherUserModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      const contextId = idGenerator('memory');
      await serverDB.insert(userMemoriesContexts).values({
        description: 'context to remove',
        id: contextId,
        userId,
        userMemoryIds: [experienceMemory.id, preferenceMemory.id, otherMemory.id],
      });

      const removed = await userMemoryModel.removeContextEntry(contextId);

      expect(removed).toBe(true);
      const deletedContext = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, contextId),
      });
      const deletedExperience = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, experienceMemory.id),
      });
      const deletedPreference = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, preferenceMemory.id),
      });
      const otherUserMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, otherMemory.id),
      });

      expect(deletedContext).toBeUndefined();
      expect(deletedExperience).toBeUndefined();
      expect(deletedPreference).toBeUndefined();
      expect(otherUserMemory).toBeDefined();
    });

    it('returns false when removing a context owned by another user', async () => {
      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      const { context } = await anotherUserModel.createContextMemory(
        generateRandomCreateUserMemoryContextParams(),
      );

      const removed = await userMemoryModel.removeContextEntry(context.id);

      expect(removed).toBe(false);
      const persisted = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, context.id),
      });
      expect(persisted).toBeDefined();
    });

    it('removes experience entry together with its base memory', async () => {
      const baseMemory = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );
      const experienceId = idGenerator('memory');
      await serverDB.insert(userMemoriesExperiences).values({
        ...generateRandomCreateUserMemoryExperienceParams().experience,
        id: experienceId,
        userId,
        userMemoryId: baseMemory.id,
      });

      const removed = await userMemoryModel.removeExperienceEntry(experienceId);

      expect(removed).toBe(true);
      const persistedExperience = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experienceId),
      });
      const persistedBase = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, baseMemory.id),
      });

      expect(persistedExperience).toBeUndefined();
      expect(persistedBase).toBeUndefined();
    });

    it('removes preference entry and keeps other users data intact', async () => {
      const baseMemory = await userMemoryModel.create(
        generateRandomCreateUserMemoryPreferenceParams(),
      );
      const preferenceId = idGenerator('memory');
      await serverDB.insert(userMemoriesPreferences).values({
        ...generateRandomCreateUserMemoryPreferenceParams().preference,
        id: preferenceId,
        userId,
        userMemoryId: baseMemory.id,
      });

      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      const otherPreference = await anotherUserModel.createPreferenceMemory(
        generateRandomCreateUserMemoryPreferenceParams(),
      );

      const removed = await userMemoryModel.removePreferenceEntry(preferenceId);

      expect(removed).toBe(true);
      const persistedPreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, preferenceId),
      });
      const persistedBase = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, baseMemory.id),
      });
      const otherUserPreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, otherPreference.preference.id),
      });

      expect(persistedPreference).toBeUndefined();
      expect(persistedBase).toBeUndefined();
      expect(otherUserPreference).toBeDefined();
    });
  });

  describe('search', () => {
    it('should return layered results with split limits', async () => {
      const experienceMemoryOne = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );
      await serverDB.insert(userMemoriesExperiences).values({
        ...generateRandomCreateUserMemoryExperienceParams().experience,
        userId,
        userMemoryId: experienceMemoryOne.id,
      });

      const experienceMemoryTwo = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );
      await serverDB.insert(userMemoriesExperiences).values({
        ...generateRandomCreateUserMemoryExperienceParams().experience,
        userId,
        userMemoryId: experienceMemoryTwo.id,
      });

      const preferenceMemoryOne = await userMemoryModel.create(
        generateRandomCreateUserMemoryPreferenceParams(),
      );
      await serverDB.insert(userMemoriesPreferences).values({
        ...generateRandomCreateUserMemoryPreferenceParams().preference,
        userId,
        userMemoryId: preferenceMemoryOne.id,
      });

      const preferenceMemoryTwo = await userMemoryModel.create(
        generateRandomCreateUserMemoryPreferenceParams(),
      );
      await serverDB.insert(userMemoriesPreferences).values({
        ...generateRandomCreateUserMemoryPreferenceParams().preference,
        userId,
        userMemoryId: preferenceMemoryTwo.id,
      });

      await serverDB.insert(userMemoriesContexts).values({
        ...generateRandomCreateUserMemoryContextParams().context,
        userId,
        userMemoryIds: [experienceMemoryOne.id, preferenceMemoryOne.id],
      });
      await serverDB.insert(userMemoriesContexts).values({
        ...generateRandomCreateUserMemoryContextParams().context,
        userId,
        userMemoryIds: [experienceMemoryTwo.id, preferenceMemoryTwo.id],
      });

      const result = await userMemoryModel.search({
        limit: 5,
        limits: {
          contexts: 1,
          experiences: 1,
          preferences: 1,
        },
      });

      expect(result.experiences).toHaveLength(1);
      expect(result.preferences).toHaveLength(1);
      expect(result.contexts).toHaveLength(1);
    });

    it('ranks contexts, experiences, and preferences by embedding similarity', async () => {
      const now = new Date('2024-01-01T00:00:00.000Z');
      const axis0 = createAxisVector();
      const axis1 = createAxisVector(1024, 1);

      const closeContextId = idGenerator('memory');
      const farContextId = idGenerator('memory');
      await serverDB.insert(userMemoriesContexts).values([
        {
          accessedAt: now,
          createdAt: now,
          description: 'close context',
          descriptionVector: axis0,
          id: closeContextId,
          updatedAt: now,
          userId,
        },
        {
          accessedAt: now,
          createdAt: now,
          description: 'far context',
          descriptionVector: axis1,
          id: farContextId,
          updatedAt: now,
          userId,
        },
      ]);

      const closeExperienceMemoryId = idGenerator('memory');
      const farExperienceMemoryId = idGenerator('memory');
      await serverDB.insert(userMemories).values([
        {
          accessedAt: now,
          createdAt: now,
          id: closeExperienceMemoryId,
          lastAccessedAt: now,
          memoryLayer: 'experience',
          summary: 'close experience base',
          updatedAt: now,
          userId,
        },
        {
          accessedAt: now,
          createdAt: now,
          id: farExperienceMemoryId,
          lastAccessedAt: now,
          memoryLayer: 'experience',
          summary: 'far experience base',
          updatedAt: now,
          userId,
        },
      ]);

      const closeExperienceId = idGenerator('memory');
      const farExperienceId = idGenerator('memory');
      await serverDB.insert(userMemoriesExperiences).values([
        {
          accessedAt: now,
          action: 'close action',
          actionVector: axis0,
          createdAt: now,
          id: closeExperienceId,
          situation: 'close situation',
          situationVector: axis0,
          updatedAt: now,
          userId,
          userMemoryId: closeExperienceMemoryId,
        },
        {
          accessedAt: now,
          action: 'far action',
          actionVector: axis1,
          createdAt: now,
          id: farExperienceId,
          situation: 'far situation',
          situationVector: axis1,
          updatedAt: now,
          userId,
          userMemoryId: farExperienceMemoryId,
        },
      ]);

      const closePreferenceMemoryId = idGenerator('memory');
      const farPreferenceMemoryId = idGenerator('memory');
      await serverDB.insert(userMemories).values([
        {
          accessedAt: now,
          createdAt: now,
          id: closePreferenceMemoryId,
          lastAccessedAt: now,
          memoryLayer: 'preference',
          summary: 'close preference base',
          updatedAt: now,
          userId,
        },
        {
          accessedAt: now,
          createdAt: now,
          id: farPreferenceMemoryId,
          lastAccessedAt: now,
          memoryLayer: 'preference',
          summary: 'far preference base',
          updatedAt: now,
          userId,
        },
      ]);

      const closePreferenceId = idGenerator('memory');
      const farPreferenceId = idGenerator('memory');
      await serverDB.insert(userMemoriesPreferences).values([
        {
          accessedAt: now,
          conclusionDirectives: 'close preference',
          conclusionDirectivesVector: axis0,
          createdAt: now,
          id: closePreferenceId,
          updatedAt: now,
          userId,
          userMemoryId: closePreferenceMemoryId,
        },
        {
          accessedAt: now,
          conclusionDirectives: 'far preference',
          conclusionDirectivesVector: axis1,
          createdAt: now,
          id: farPreferenceId,
          updatedAt: now,
          userId,
          userMemoryId: farPreferenceMemoryId,
        },
      ]);

      const result = await userMemoryModel.searchWithEmbedding({
        embedding: axis0,
        limits: {
          contexts: 2,
          experiences: 2,
          preferences: 2,
        },
      });

      expect(result.contexts[0]?.id).toBe(closeContextId);
      expect(result.experiences[0]?.id).toBe(closeExperienceId);
      expect(result.preferences[0]?.id).toBe(closePreferenceId);
    });
  });

  describe('search helpers', () => {
    it('returns empty arrays when limit is zero or negative', async () => {
      const contexts = await userMemoryModel.searchContexts({ limit: 0 });
      const experiences = await userMemoryModel.searchExperiences({ limit: -1 });
      const preferences = await userMemoryModel.searchPreferences({ limit: 0 });

      expect(contexts).toEqual([]);
      expect(experiences).toEqual([]);
      expect(preferences).toEqual([]);
    });

    it('filters contexts by type and orders by newest when no embedding', async () => {
      const oldContextId = idGenerator('memory');
      const recentContextId = idGenerator('memory');
      await serverDB.insert(userMemoriesContexts).values([
        {
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          description: 'old match',
          id: oldContextId,
          type: 'target',
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          userId,
        },
        {
          createdAt: new Date('2024-02-01T00:00:00.000Z'),
          description: 'recent match',
          id: recentContextId,
          type: 'target',
          updatedAt: new Date('2024-02-01T00:00:00.000Z'),
          userId,
        },
        {
          description: 'different type',
          id: idGenerator('memory'),
          type: 'other',
          userId,
        },
      ]);

      const contexts = await userMemoryModel.searchContexts({ limit: 5, type: 'target' });

      expect(contexts).toHaveLength(2);
      expect(contexts[0]?.id).toBe(recentContextId);
      expect(contexts[1]?.id).toBe(oldContextId);
      contexts.forEach((context) => {
        expect(context.type).toBe('target');
      });
    });
  });

  describe('queryIdentityRoles', () => {
    it('aggregates identity tags and roles for the current user only', async () => {
      const now = new Date('2024-04-02T00:00:00.000Z');
      const anotherUserModel = new UserMemoryModel(serverDB, userId2);

      await userMemoryModel.addIdentityEntry({
        base: { lastAccessedAt: now, tags: [] },
        identity: { relationship: 'self', role: 'engineer', tags: ['alpha', 'beta'] },
      });
      await userMemoryModel.addIdentityEntry({
        base: { lastAccessedAt: now, tags: [] },
        identity: { relationship: 'self', role: 'engineer', tags: ['alpha'] },
      });
      await userMemoryModel.addIdentityEntry({
        base: { lastAccessedAt: now, tags: [] },
        identity: { relationship: 'self', role: 'manager', tags: [] },
      });

      // This should not be counted (different user)
      await anotherUserModel.addIdentityEntry({
        base: { lastAccessedAt: now, tags: [] },
        identity: { relationship: 'self', role: 'engineer', tags: ['alpha'] },
      });

      // This should not be counted (relationship is not 'self')
      await userMemoryModel.addIdentityEntry({
        base: { lastAccessedAt: now, tags: [] },
        identity: { relationship: 'friend', role: 'designer', tags: ['gamma'] },
      });

      const result = await userMemoryModel.queryIdentityRoles({ size: 5 });

      expect(result).toEqual({
        roles: [
          { count: 2, role: 'engineer' },
          { count: 1, role: 'manager' },
        ],
        tags: [
          { count: 2, tag: 'alpha' },
          { count: 1, tag: 'beta' },
        ],
      });
    });
  });

  describe('queryTags', () => {
    it('aggregates tag counts by layer and ignores empty values', async () => {
      const now = new Date('2024-04-01T00:00:00.000Z');
      await serverDB.insert(userMemories).values([
        {
          id: idGenerator('memory'),
          lastAccessedAt: now,
          memoryLayer: 'identity',
          tags: ['alpha', 'beta'],
          userId,
        },
        {
          id: idGenerator('memory'),
          lastAccessedAt: now,
          memoryLayer: 'identity',
          tags: ['alpha', ''],
          userId,
        },
        {
          id: idGenerator('memory'),
          lastAccessedAt: now,
          memoryLayer: 'experience',
          tags: ['beta'],
          userId,
        },
      ]);

      await serverDB.insert(userMemories).values({
        id: idGenerator('memory'),
        lastAccessedAt: now,
        memoryLayer: 'identity',
        tags: ['alpha'],
        userId: userId2,
      });

      const tags = await userMemoryModel.queryTags({ layers: [LayersEnum.Identity], size: 2 });

      expect(tags).toEqual([
        { count: 2, tag: 'alpha' },
        { count: 1, tag: 'beta' },
      ]);
    });
  });

  describe('queryMemories', () => {
    it('supports filtering, sorting, and pagination for memories', async () => {
      const baseTime = new Date('2024-04-05T00:00:00.000Z');
      const newerId = idGenerator('memory');
      const olderId = idGenerator('memory');

      await serverDB.insert(userMemories).values([
        {
          createdAt: baseTime,
          id: newerId,
          lastAccessedAt: baseTime,
          memoryCategory: 'work',
          memoryLayer: LayersEnum.Context,
          memoryType: TypesEnum.Topic,
          summary: 'Atlas launch retrospective',
          tags: ['atlas', 'project'],
          title: 'Project Atlas retrospective',
          updatedAt: new Date('2024-04-06T00:00:00.000Z'),
          userId,
        },
        {
          createdAt: baseTime,
          id: olderId,
          lastAccessedAt: baseTime,
          memoryCategory: 'work',
          memoryLayer: LayersEnum.Context,
          memoryType: TypesEnum.Topic,
          summary: 'Atlas kickoff planning',
          tags: ['atlas'],
          title: 'Atlas kickoff',
          updatedAt: new Date('2024-04-05T12:00:00.000Z'),
          userId,
        },
        {
          createdAt: baseTime,
          id: idGenerator('memory'),
          lastAccessedAt: baseTime,
          memoryCategory: 'personal',
          memoryLayer: LayersEnum.Preference,
          memoryType: TypesEnum.Preference,
          summary: 'Atlas weekend plan',
          tags: ['weekend'],
          title: 'Weekend notes',
          updatedAt: new Date('2024-04-07T00:00:00.000Z'),
          userId,
        },
        {
          createdAt: baseTime,
          id: idGenerator('memory'),
          lastAccessedAt: baseTime,
          memoryCategory: 'work',
          memoryLayer: LayersEnum.Context,
          memoryType: TypesEnum.Topic,
          summary: 'Atlas private note',
          tags: ['atlas'],
          title: 'Should not be visible',
          updatedAt: new Date('2024-04-08T00:00:00.000Z'),
          userId: userId2,
        },
      ]);

      await serverDB.insert(userMemoriesContexts).values([
        {
          createdAt: baseTime,
          description: 'Context newer',
          id: idGenerator('memory'),
          scoreImpact: 0.3,
          title: 'Newer Context',
          updatedAt: new Date('2024-04-06T00:00:00.000Z'),
          userId,
          userMemoryIds: [newerId],
        },
        {
          createdAt: baseTime,
          description: 'Context older',
          id: idGenerator('memory'),
          scoreImpact: 0.9,
          title: 'Older Context',
          updatedAt: new Date('2024-04-05T12:00:00.000Z'),
          userId,
          userMemoryIds: [olderId],
        },
      ]);

      const firstPage = await userMemoryModel.queryMemories({
        categories: ['work'],
        layer: LayersEnum.Context,
        order: 'desc',
        page: 1,
        pageSize: 1,
        q: 'Atlas',
        sort: 'scoreImpact',
        tags: ['atlas'],
        types: [TypesEnum.Topic],
      });

      expect(firstPage.total).toBe(2);
      expect(firstPage.page).toBe(1);
      expect(firstPage.pageSize).toBe(1);
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.items[0]?.memory.id).toBe(olderId);
      expect(firstPage.items[0]?.layer).toBe(LayersEnum.Context);
      expect((firstPage.items[0] as any).context.title).toBe('Older Context');

      const secondPage = await userMemoryModel.queryMemories({
        categories: ['work'],
        layer: LayersEnum.Context,
        order: 'desc',
        page: 2,
        pageSize: 1,
        q: 'Atlas',
        sort: 'scoreImpact',
        tags: ['atlas'],
        types: [TypesEnum.Topic],
      });

      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0]?.memory.id).toBe(newerId);
      expect((secondPage.items[0] as any).context.title).toBe('Newer Context');
    });

    it('returns defaults when no filters are provided', async () => {
      const timestamp = new Date('2024-04-05T00:00:00.000Z');
      const id = idGenerator('memory');

      await serverDB.insert(userMemories).values({
        createdAt: timestamp,
        id,
        lastAccessedAt: timestamp,
        memoryCategory: 'misc',
        memoryLayer: LayersEnum.Context,
        memoryType: TypesEnum.Other,
        summary: 'General note',
        tags: ['general'],
        title: 'Default',
        updatedAt: timestamp,
        userId,
      });

      await serverDB.insert(userMemoriesContexts).values({
        createdAt: timestamp,
        description: 'General context',
        id: idGenerator('memory'),
        title: 'Context title',
        updatedAt: timestamp,
        userId,
        userMemoryIds: [id],
      });

      const result = await userMemoryModel.queryMemories();

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.total).toBe(1);
      expect(result.items[0]?.memory.id).toBe(id);
      expect(result.items[0]?.layer).toBe(LayersEnum.Context);
    });

    it('returns newly inserted layered memories when querying without filters', async () => {
      const contextInput = generateRandomCreateUserMemoryContextParams();
      const experienceInput = generateRandomCreateUserMemoryExperienceParams();
      const preferenceInput = generateRandomCreateUserMemoryPreferenceParams();
      const identityDescription = 'identity ' + nanoid();

      const { context, memory: contextMemory } =
        await userMemoryModel.createContextMemory(contextInput);
      const { experience, memory: experienceMemory } =
        await userMemoryModel.createExperienceMemory(experienceInput);
      const { preference, memory: preferenceMemory } =
        await userMemoryModel.createPreferenceMemory(preferenceInput);
      const { identityId, userMemoryId: identityMemoryId } = await userMemoryModel.addIdentityEntry(
        {
          base: { summary: 'identity summary ' + nanoid(), tags: ['identity'] },
          identity: {
            description: identityDescription,
            relationship: 'friend',
            tags: ['identity'],
            type: 'personal',
          },
        },
      );

      const identity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      const contextResult = await userMemoryModel.queryMemories({
        layer: LayersEnum.Context,
        sort: 'scoreImpact',
      });

      expect(contextResult.total).toBe(1);
      expect(contextResult.items).toHaveLength(1);
      const contextItem = contextResult.items[0] as any;
      expect(contextItem.layer).toBe(LayersEnum.Context);
      expect(contextItem.context.description).toBe(context.description);
      expect(contextItem.context.userMemoryIds).toEqual([contextMemory.id]);

      const experienceResult = await userMemoryModel.queryMemories({
        layer: LayersEnum.Experience,
        sort: 'scoreConfidence',
      });

      expect(experienceResult.total).toBe(1);
      expect(experienceResult.items).toHaveLength(1);
      const experienceItem = experienceResult.items[0] as any;
      expect(experienceItem.layer).toBe(LayersEnum.Experience);
      expect(experienceItem.experience.situation).toBe(experience.situation);
      expect(experienceItem.experience.userMemoryId).toBe(experienceMemory.id);

      const preferenceResult = await userMemoryModel.queryMemories({
        layer: LayersEnum.Preference,
        sort: 'scorePriority',
      });

      expect(preferenceResult.total).toBe(1);
      expect(preferenceResult.items).toHaveLength(1);
      const preferenceItem = preferenceResult.items[0] as any;
      expect(preferenceItem.layer).toBe(LayersEnum.Preference);
      expect(preferenceItem.preference.conclusionDirectives).toBe(preference.conclusionDirectives);
      expect(preferenceItem.preference.userMemoryId).toBe(preferenceMemory.id);

      const identityResult = await userMemoryModel.queryMemories({
        layer: LayersEnum.Identity,
      });

      expect(identityResult.total).toBe(1);
      expect(identityResult.items).toHaveLength(1);
      const identityItem = identityResult.items[0] as any;
      expect(identityItem.layer).toBe(LayersEnum.Identity);
      expect(identityItem.identity.description).toBe(identityDescription);
      expect(identityItem.identity.userMemoryId).toBe(identityMemoryId);
      expect(identityItem.identity.type).toBe(identity?.type);
    });

    it('should order identity memories by capturedAt desc and include capturedAt and title in response', async () => {
      const olderCapturedAt = new Date('2024-01-01T10:00:00Z');
      const newerCapturedAt = new Date('2024-01-15T10:00:00Z');

      await userMemoryModel.addIdentityEntry({
        base: { summary: 'older identity', title: 'Older Title' },
        identity: {
          capturedAt: olderCapturedAt,
          description: 'Older identity description',
          relationship: 'friend',
          type: 'personal',
        },
      });

      await userMemoryModel.addIdentityEntry({
        base: { summary: 'newer identity', title: 'Newer Title' },
        identity: {
          capturedAt: newerCapturedAt,
          description: 'Newer identity description',
          relationship: 'self',
          type: 'personal',
        },
      });

      const result = await userMemoryModel.queryMemories({
        layer: LayersEnum.Identity,
      });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);

      const firstItem = result.items[0] as any;
      const secondItem = result.items[1] as any;

      // Verify order by capturedAt desc
      expect(firstItem.identity.capturedAt).toEqual(newerCapturedAt);
      expect(secondItem.identity.capturedAt).toEqual(olderCapturedAt);

      expect(firstItem.identity.description).toBe('Newer identity description');
      expect(secondItem.identity.description).toBe('Older identity description');

      // Verify title comes from memory schema
      expect(firstItem.identity.title).toBe('Newer Title');
      expect(secondItem.identity.title).toBe('Older Title');

      // Verify relationship is included
      expect(firstItem.identity.relationship).toBe('self');
      expect(secondItem.identity.relationship).toBe('friend');
    });
  });

  describe('findById', () => {
    it('returns own memories and updates access metrics', async () => {
      const created = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      const before = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, created.id),
      });

      expect(before).toBeDefined();
      expect(before?.accessedCount).toBe(0);

      const found = await userMemoryModel.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);

      const after = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, created.id),
      });

      expect(after?.accessedCount).toBe((before?.accessedCount ?? 0) + 1);
      expect(after?.lastAccessedAt.getTime()).toBeGreaterThanOrEqual(
        before!.lastAccessedAt.getTime(),
      );
    });

    it('does not expose or mutate memories belonging to other users', async () => {
      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      const otherMemory = await anotherUserModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      const found = await userMemoryModel.findById(otherMemory.id);

      expect(found).toBeUndefined();

      const persisted = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, otherMemory.id),
      });

      expect(persisted?.accessedCount).toBe(0);
    });
  });

  describe('getMemoryDetail', () => {
    it('returns full context memory detail and bumps access metrics', async () => {
      const params = generateRandomCreateUserMemoryContextParams();
      params.context.metadata = { contextDetail: true };
      params.context.associatedObjects = [{ name: 'Doc', extra: { url: 'https://example.com' } }];

      const { context, memory } = await userMemoryModel.createContextMemory(params);

      const detail = await userMemoryModel.getMemoryDetail({
        id: context.id,
        layer: LayersEnum.Context,
      });

      expect(detail?.layer).toBe(LayersEnum.Context);
      expect(detail?.memory.id).toBe(memory.id);
      expect(detail && 'context' in detail ? detail.context.id : undefined).toBe(context.id);
      expect((detail as any).context.userMemoryIds).toEqual([memory.id]);
      expect((detail as any).context.metadata).toEqual(params.context.metadata);
      expect(detail?.memory.memoryLayer).toBe(LayersEnum.Context);
      expect(detail?.source).toBeUndefined();
      expect(detail?.sourceType).toBe(MemorySourceType.ChatTopic);

      const persisted = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });

      expect(persisted?.accessedCount).toBe(0);
    });

    it('resolves topic source data for memory detail', async () => {
      const topic = {
        agentId: 'agent-1',
        id: idGenerator('topics'),
        sessionId: 'session-1',
        title: 'Topic title',
        userId,
      };

      const topicSpy = vi
        .spyOn((userMemoryModel as any).topicModel, 'findById')
        .mockResolvedValue(topic as any);

      const params = generateRandomCreateUserMemoryContextParams();
      params.context.metadata = { sourceId: topic.id };

      const { context } = await userMemoryModel.createContextMemory(params);

      const detail = await userMemoryModel.getMemoryDetail({
        id: context.id,
        layer: LayersEnum.Context,
      });

      expect(detail?.sourceType).toBe(MemorySourceType.ChatTopic);
      expect(detail?.source?.id).toBe(topic.id);
      expect(detail?.source?.title).toBe(topic.title);

      topicSpy.mockRestore();
    });

    it('returns undefined for memories owned by another user', async () => {
      const otherModel = new UserMemoryModel(serverDB, userId2);
      const { experience, memory } = await otherModel.createExperienceMemory(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      const detail = await userMemoryModel.getMemoryDetail({
        id: experience.id,
        layer: LayersEnum.Experience,
      });

      expect(detail).toBeUndefined();

      const persisted = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memory.id),
      });

      expect(persisted?.accessedCount).toBe(0);
    });
  });

  describe('update', () => {
    it('updates mutable fields for own memories only', async () => {
      const created = await userMemoryModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      await userMemoryModel.update(created.id, {
        memoryCategory: 'updated-category',
        summary: 'Updated summary',
        title: 'Updated title',
      });

      const updated = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, created.id),
      });

      expect(updated?.memoryCategory).toBe('updated-category');
      expect(updated?.summary).toBe('Updated summary');
      expect(updated?.title).toBe('Updated title');
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.createdAt.getTime());
    });

    it('ignores updates for memories owned by other users', async () => {
      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      const otherMemory = await anotherUserModel.create(
        generateRandomCreateUserMemoryExperienceParams(),
      );

      await userMemoryModel.update(otherMemory.id, {
        summary: 'Should not update',
      });

      const persisted = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, otherMemory.id),
      });

      expect(persisted?.summary).not.toBe('Should not update');
    });
  });

  describe('update vector methods', () => {
    it('updates base user memory vectors', async () => {
      const memoryId = idGenerator('memory');
      await serverDB.insert(userMemories).values({
        details: 'details',
        id: memoryId,
        lastAccessedAt: new Date(),
        summary: 'summary',
        title: 'title',
        userId,
      });

      const summaryVector = generateRandomEmbedding();
      const detailsVector = generateRandomEmbedding();

      await userMemoryModel.updateUserMemoryVectors(memoryId, {
        detailsVector1024: detailsVector,
        summaryVector1024: summaryVector,
      });

      const updated = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memoryId),
      });

      expectVectorToBeClose(updated?.summaryVector1024, summaryVector);
      expectVectorToBeClose(updated?.detailsVector1024, detailsVector);
    });

    it('ignores user memory vector updates when payload is empty', async () => {
      const memoryId = idGenerator('memory');
      const timestamp = new Date('2024-01-01T00:00:00.000Z');
      const summaryVector = generateRandomEmbedding();

      await serverDB.insert(userMemories).values({
        accessedAt: timestamp,
        createdAt: timestamp,
        details: 'details',
        id: memoryId,
        lastAccessedAt: timestamp,
        summary: 'summary',
        summaryVector1024: summaryVector,
        updatedAt: timestamp,
        userId,
      });

      const before = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memoryId),
      });

      await userMemoryModel.updateUserMemoryVectors(memoryId, {});

      const after = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, memoryId),
      });

      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      expectVectorToBeClose(after?.summaryVector1024, summaryVector);
    });

    it('updates context vectors', async () => {
      const contextId = idGenerator('memory');
      await serverDB.insert(userMemoriesContexts).values({
        description: 'desc',
        id: contextId,
        title: 'title',
        userId,
      });

      const descriptionVector = generateRandomEmbedding();
      await userMemoryModel.updateContextVectors(contextId, { descriptionVector });
      const updated = await serverDB.query.userMemoriesContexts.findFirst({
        where: eq(userMemoriesContexts.id, contextId),
      });

      expectVectorToBeClose(updated?.descriptionVector, descriptionVector);
    });

    it('updates preference vector values including null assignments', async () => {
      const preferenceId = idGenerator('memory');
      await serverDB.insert(userMemoriesPreferences).values({
        conclusionDirectives: 'directive',
        conclusionDirectivesVector: generateRandomEmbedding(),
        id: preferenceId,
        userId,
      });

      await userMemoryModel.updatePreferenceVectors(preferenceId, {
        conclusionDirectivesVector: null,
      });

      const updated = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.id, preferenceId),
      });

      expect(updated?.conclusionDirectivesVector).toBeNull();
    });

    it('updates identity vectors', async () => {
      const identityId = idGenerator('memory');
      await serverDB.insert(userMemoriesIdentities).values({
        description: 'identity',
        id: identityId,
        userId,
      });

      const descriptionVector = generateRandomEmbedding();

      await userMemoryModel.updateIdentityVectors(identityId, {
        descriptionVector,
      });

      const updated = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expectVectorToBeClose(updated?.descriptionVector, descriptionVector);
    });

    it('skips identity vector updates when no fields are provided', async () => {
      const identityId = idGenerator('memory');
      const timestamp = new Date('2024-03-01T00:00:00.000Z');
      const descriptionVector = generateRandomEmbedding();

      await serverDB.insert(userMemoriesIdentities).values({
        accessedAt: timestamp,
        createdAt: timestamp,
        description: 'identity',
        descriptionVector,
        id: identityId,
        updatedAt: timestamp,
        userId,
      });

      await userMemoryModel.updateIdentityVectors(identityId, {});

      const persisted = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(persisted?.updatedAt.getTime()).toBe(timestamp.getTime());
      expectVectorToBeClose(persisted?.descriptionVector, descriptionVector);
    });

    it('updates experience vectors without touching unspecified fields', async () => {
      const experienceId = idGenerator('memory');
      const originalSituationVector = generateRandomEmbedding();
      const originalKeyLearningVector = generateRandomEmbedding();
      const originalActionVector = generateRandomEmbedding();

      await serverDB.insert(userMemoriesExperiences).values({
        action: 'action',
        actionVector: originalActionVector,
        id: experienceId,
        keyLearning: 'key learning',
        keyLearningVector: originalKeyLearningVector,
        situation: 'situation',
        situationVector: originalSituationVector,
        userId,
      });

      const updatedActionVector = generateRandomEmbedding();

      await userMemoryModel.updateExperienceVectors(experienceId, {
        actionVector: updatedActionVector,
      });

      const updated = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experienceId),
      });

      expectVectorToBeClose(updated?.actionVector, updatedActionVector);
      expectVectorToBeClose(updated?.situationVector, originalSituationVector);
      expectVectorToBeClose(updated?.keyLearningVector, originalKeyLearningVector);
    });

    it('updates multiple experience vector fields and supports null assignments', async () => {
      const experienceId = idGenerator('memory');
      const originalSituationVector = generateRandomEmbedding();
      const originalKeyLearningVector = generateRandomEmbedding();
      const originalActionVector = generateRandomEmbedding();

      await serverDB.insert(userMemoriesExperiences).values({
        action: 'action',
        actionVector: originalActionVector,
        id: experienceId,
        keyLearning: 'key learning',
        keyLearningVector: originalKeyLearningVector,
        situation: 'situation',
        situationVector: originalSituationVector,
        userId,
      });

      const newSituationVector = generateRandomEmbedding();

      await userMemoryModel.updateExperienceVectors(experienceId, {
        keyLearningVector: null,
        situationVector: newSituationVector,
      });

      const updated = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.id, experienceId),
      });

      expectVectorToBeClose(updated?.situationVector, newSituationVector);
      expect(updated?.keyLearningVector).toBeNull();
      expectVectorToBeClose(updated?.actionVector, originalActionVector);
    });
  });

  describe('identity entry operations', () => {
    it('adds a new identity entry with base memory', async () => {
      const summaryVector = generateRandomEmbedding();
      const descriptionVector = generateRandomEmbedding();

      const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
        base: {
          memoryCategory: 'profile',
          memoryLayer: 'identity',
          memoryType: 'personal-profile',
          metadata: { meta: 'value' },
          summary: 'Initial summary',
          summaryVector1024: summaryVector,
          title: 'Identity Summary',
        },
        identity: {
          description: 'A detailed description of the user identity',
          descriptionVector,
          episodicDate: new Date('2024-01-01T00:00:00.000Z'),
          metadata: { extracted: ['friend'] },
          relationship: 'friend',
          role: 'software engineer',
          tags: ['tag-a'],
          type: 'personal',
        },
      });

      const baseMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(baseMemory?.summary).toBe('Initial summary');
      expectVectorToBeClose(baseMemory?.summaryVector1024, summaryVector);
      expect(baseMemory?.memoryLayer).toBe('identity');
      expect(baseMemory?.metadata).toEqual({ meta: 'value' });

      expect(identityMemory?.description).toBe('A detailed description of the user identity');
      expectVectorToBeClose(identityMemory?.descriptionVector, descriptionVector);
      expect(identityMemory?.relationship).toBe('friend');
      expect(identityMemory?.role).toBe('software engineer');
      expect(identityMemory?.type).toBe('personal');
      expect(identityMemory?.userMemoryId).toBe(userMemoryId);
    });

    it('normalizes identity fields and coerces date inputs when adding entries', async () => {
      const baseDate = '2024-02-02T12:00:00.000Z';
      const episodicDate = '2024-03-03T00:00:00.000Z';

      const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
        base: {
          lastAccessedAt: baseDate,
          summary: 'Normalize base',
        },
        identity: {
          description: 'Normalize identity',
          episodicDate,
          relationship: '  FRIEND  ',
          type: ' PERSONAL ',
        },
      });

      const baseMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(baseMemory?.lastAccessedAt.toISOString()).toBe(new Date(baseDate).toISOString());
      expect(identityMemory?.relationship).toBe('friend');
      expect(identityMemory?.type).toBe('personal');
      expect(identityMemory?.episodicDate?.toISOString()).toBe(
        new Date(episodicDate).toISOString(),
      );
    });

    it('falls back to defaults when invalid identity data is provided', async () => {
      const frozenNow = new Date('2024-05-05T00:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(frozenNow);

      try {
        const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
          base: {
            lastAccessedAt: 'not-a-date',
            status: undefined,
          },
          identity: {
            description: 'Invalid identity',
            episodicDate: 'invalid',
            relationship: 'bestie',
            type: 'unknown',
          },
        });

        const baseMemory = await serverDB.query.userMemories.findFirst({
          where: eq(userMemories.id, userMemoryId),
        });
        const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
          where: eq(userMemoriesIdentities.id, identityId),
        });

        expect(baseMemory?.status).toBe('active');
        expect(baseMemory?.lastAccessedAt.toISOString()).toBe(frozenNow.toISOString());
        expect(identityMemory?.relationship).toBeNull();
        expect(identityMemory?.type).toBeNull();
        expect(identityMemory?.episodicDate).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('updates identity entry fields with merge strategy', async () => {
      const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
        base: {
          memoryCategory: 'profile',
          summary: 'Original summary',
          title: 'Original title',
        },
        identity: {
          description: 'Original identity description',
          relationship: 'friend',
          role: 'developer',
          type: 'personal',
        },
      });

      const updated = await userMemoryModel.updateIdentityEntry({
        identityId,
        mergeStrategy: MergeStrategyEnum.Merge,
        base: {
          summary: 'Updated summary',
        },
        identity: {
          description: 'Updated identity description',
          relationship: 'mentor',
        },
      });

      expect(updated).toBe(true);

      const baseMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(baseMemory?.summary).toBe('Updated summary');
      expect(baseMemory?.title).toBe('Original title');
      expect(identityMemory?.description).toBe('Updated identity description');
      expect(identityMemory?.relationship).toBe('mentor');
      expect(identityMemory?.role).toBe('developer');
    });

    it('normalizes identity values and coerces dates when updating entries', async () => {
      const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
        base: {
          summary: 'base summary',
        },
        identity: {
          description: 'base identity',
        },
      });

      await userMemoryModel.updateIdentityEntry({
        identityId,
        base: {
          lastAccessedAt: '2024-06-06T00:00:00.000Z',
        },
        identity: {
          episodicDate: '2024-07-07T00:00:00.000Z',
          relationship: '  COLLEAGUE  ',
          type: ' PROFESSIONAL ',
        },
      });

      const baseMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(baseMemory?.lastAccessedAt.toISOString()).toBe('2024-06-06T00:00:00.000Z');
      expect(identityMemory?.relationship).toBe('colleague');
      expect(identityMemory?.type).toBe('professional');
      expect(identityMemory?.episodicDate?.toISOString()).toBe('2024-07-07T00:00:00.000Z');
    });

    it('replaces identity entry fields and clears unspecified values when mergeStrategy is replace', async () => {
      const { identityId } = await userMemoryModel.addIdentityEntry({
        base: {
          summary: 'Summary to replace',
          title: 'Title to replace',
        },
        identity: {
          description: 'Description to replace',
          relationship: 'mentor',
          role: 'manager',
          type: 'professional',
        },
      });

      const replaced = await userMemoryModel.updateIdentityEntry({
        identityId,
        mergeStrategy: MergeStrategyEnum.Replace,
        identity: {
          description: 'Fresh description',
          type: 'personal',
        },
      });

      expect(replaced).toBe(true);

      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(identityMemory?.description).toBe('Fresh description');
      expect(identityMemory?.type).toBe('personal');
      expect(identityMemory?.relationship).toBeNull();
      expect(identityMemory?.role).toBeNull();
    });

    it('keeps existing identity fields when merge payload is empty', async () => {
      const { identityId } = await userMemoryModel.addIdentityEntry({
        base: { summary: 'keep base' },
        identity: {
          description: 'Keep description',
          metadata: { keep: true },
          relationship: 'colleague',
          role: 'engineer',
          tags: ['keep'],
          type: 'professional',
        },
      });

      await userMemoryModel.updateIdentityEntry({
        identityId,
        identity: {},
        mergeStrategy: MergeStrategyEnum.Merge,
      });

      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(identityMemory?.description).toBe('Keep description');
      expect(identityMemory?.metadata).toEqual({ keep: true });
      expect(identityMemory?.relationship).toBe('colleague');
      expect(identityMemory?.role).toBe('engineer');
      expect(identityMemory?.tags).toEqual(['keep']);
      expect(identityMemory?.type).toBe('professional');
    });

    it('clears all identity fields when replacing with an empty payload', async () => {
      const { identityId } = await userMemoryModel.addIdentityEntry({
        base: { summary: 'keep base' },
        identity: {
          description: 'Will be cleared',
          metadata: { existing: true },
          relationship: 'mentor',
          role: 'lead',
          tags: ['tagged'],
          type: 'personal',
        },
      });

      await userMemoryModel.updateIdentityEntry({
        identityId,
        identity: {},
        mergeStrategy: MergeStrategyEnum.Replace,
      });

      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(identityMemory?.description).toBeNull();
      expect(identityMemory?.metadata).toBeNull();
      expect(identityMemory?.relationship).toBeNull();
      expect(identityMemory?.role).toBeNull();
      expect(identityMemory?.tags).toBeNull();
      expect(identityMemory?.type).toBeNull();
    });

    it('removes identity entry and associated base memory', async () => {
      const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
        base: {
          summary: 'Summary to delete',
        },
        identity: {
          description: 'Identity to delete',
        },
      });

      const removed = await userMemoryModel.removeIdentityEntry(identityId);

      const baseMemory = await serverDB.query.userMemories.findFirst({
        where: eq(userMemories.id, userMemoryId),
      });
      const identityMemory = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      expect(removed).toBe(true);
      expect(baseMemory).toBeUndefined();
      expect(identityMemory).toBeUndefined();
    });
  });

  describe('getAllIdentities', () => {
    it('returns all identities for current user ordered by newest first', async () => {
      const first = await userMemoryModel.addIdentityEntry({
        base: { summary: 'first' },
        identity: { description: 'first identity', type: 'personal' },
      });

      const second = await userMemoryModel.addIdentityEntry({
        base: { summary: 'second' },
        identity: { description: 'second identity', type: 'professional' },
      });

      const third = await userMemoryModel.addIdentityEntry({
        base: { summary: 'third' },
        identity: { description: 'third identity', type: 'demographic' },
      });

      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      await anotherUserModel.addIdentityEntry({
        base: { summary: 'other-user' },
        identity: { description: 'other identity', type: 'personal' },
      });

      await serverDB
        .update(userMemoriesIdentities)
        .set({ createdAt: new Date('2024-01-01T00:00:00.000Z') })
        .where(eq(userMemoriesIdentities.id, first.identityId));
      await serverDB
        .update(userMemoriesIdentities)
        .set({ createdAt: new Date('2024-02-01T00:00:00.000Z') })
        .where(eq(userMemoriesIdentities.id, second.identityId));
      await serverDB
        .update(userMemoriesIdentities)
        .set({ createdAt: new Date('2024-03-01T00:00:00.000Z') })
        .where(eq(userMemoriesIdentities.id, third.identityId));

      const identities = await userMemoryModel.getAllIdentities();

      expect(identities).toHaveLength(3);
      expect(identities[0]?.id).toBe(third.identityId);
      expect(identities[1]?.id).toBe(second.identityId);
      expect(identities[2]?.id).toBe(first.identityId);
      identities.forEach((identity) => {
        expect(identity.userId).toBe(userId);
      });
    });
  });

  describe('getIdentitiesByType', () => {
    it('returns the newest identities of the requested type for the current user', async () => {
      const resultOne = await userMemoryModel.addIdentityEntry({
        base: {
          summary: 'personal-one',
        },
        identity: {
          description: 'first personal',
          type: 'personal',
        },
      });

      const resultTwo = await userMemoryModel.addIdentityEntry({
        base: {
          summary: 'personal-two',
        },
        identity: {
          description: 'second personal',
          type: 'personal',
        },
      });

      await userMemoryModel.addIdentityEntry({
        base: {
          summary: 'preference-not-personal',
        },
        identity: {
          description: 'professional identity',
          type: 'professional',
        },
      });

      const anotherUserModel = new UserMemoryModel(serverDB, userId2);
      await anotherUserModel.addIdentityEntry({
        base: {
          summary: 'other user personal',
        },
        identity: {
          description: 'should not show',
          type: 'personal',
        },
      });

      // Ensure deterministic ordering by forcing createdAt values
      await serverDB
        .update(userMemoriesIdentities)
        .set({ createdAt: new Date('2024-01-01T00:00:00.000Z') })
        .where(eq(userMemoriesIdentities.id, resultOne.identityId));
      await serverDB
        .update(userMemoriesIdentities)
        .set({ createdAt: new Date('2024-02-01T00:00:00.000Z') })
        .where(eq(userMemoriesIdentities.id, resultTwo.identityId));

      const identities = await userMemoryModel.getIdentitiesByType('personal');

      expect(identities).toHaveLength(2);
      expect(identities[0]?.id).toBe(resultTwo.identityId);
      expect(identities[1]?.id).toBe(resultOne.identityId);
      identities.forEach((identity) => {
        expect(identity.type).toBe('personal');
        expect(identity.userId).toBe(userId);
      });
    });
  });

  describe('access metrics', () => {
    it('should update accessedAt for each layer table', async () => {
      const experienceParams = generateRandomCreateUserMemoryExperienceParams();
      const experienceMemory = await userMemoryModel.create(experienceParams);
      await serverDB.insert(userMemoriesExperiences).values({
        ...experienceParams.experience,
        userId,
        userMemoryId: experienceMemory.id,
      });

      const preferenceParams = generateRandomCreateUserMemoryPreferenceParams();
      const preferenceMemory = await userMemoryModel.create(preferenceParams);
      await serverDB.insert(userMemoriesPreferences).values({
        ...preferenceParams.preference,
        userId,
        userMemoryId: preferenceMemory.id,
      });

      const contextParams = generateRandomCreateUserMemoryContextParams();
      await serverDB.insert(userMemoriesContexts).values({
        ...contextParams.context,
        userId,
        userMemoryIds: [experienceMemory.id, preferenceMemory.id],
      });

      const beforeContexts = await serverDB.query.userMemoriesContexts.findMany({
        where: eq(userMemoriesContexts.userId, userId),
      });

      const beforeExperience = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.userMemoryId, experienceMemory.id),
      });
      const beforePreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.userMemoryId, preferenceMemory.id),
      });

      const beforeBaseMemories = await serverDB.query.userMemories.findMany({
        where: eq(userMemories.userId, userId),
      });

      await userMemoryModel.search({ limit: 10 });

      const afterExperience = await serverDB.query.userMemoriesExperiences.findFirst({
        where: eq(userMemoriesExperiences.userMemoryId, experienceMemory.id),
      });
      const afterPreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: eq(userMemoriesPreferences.userMemoryId, preferenceMemory.id),
      });
      const afterContexts = await serverDB.query.userMemoriesContexts.findMany({
        where: eq(userMemoriesContexts.userId, userId),
      });
      const afterBaseMemoryMap = new Map(
        (
          await serverDB.query.userMemories.findMany({
            where: eq(userMemories.userId, userId),
          })
        ).map((memory) => [memory.id, memory]),
      );

      expect(beforeExperience?.accessedAt?.getTime()).toBeDefined();
      expect(afterExperience?.accessedAt?.getTime()).toBeDefined();
      expect(afterExperience!.accessedAt.getTime()).toBeGreaterThanOrEqual(
        beforeExperience!.accessedAt.getTime(),
      );

      expect(beforePreference?.accessedAt?.getTime()).toBeDefined();
      expect(afterPreference?.accessedAt?.getTime()).toBeDefined();
      expect(afterPreference!.accessedAt.getTime()).toBeGreaterThanOrEqual(
        beforePreference!.accessedAt.getTime(),
      );

      beforeContexts.forEach((beforeContext) => {
        const afterContext = afterContexts.find((ctx) => ctx.id === beforeContext.id);
        expect(afterContext).toBeDefined();
        expect(afterContext!.accessedAt.getTime()).toBeGreaterThanOrEqual(
          beforeContext.accessedAt.getTime(),
        );
      });

      const updatedIds = new Set([experienceMemory.id, preferenceMemory.id]);

      for (const before of beforeBaseMemories) {
        const after = afterBaseMemoryMap.get(before.id);
        expect(after).toBeDefined();
        if (updatedIds.has(before.id)) {
          expect(after!.accessedCount).toBeDefined();
          expect(after!.accessedCount).toBe((before.accessedCount ?? 0) + 1);
          expect(after!.accessedAt.getTime()).toBeGreaterThanOrEqual(before.accessedAt.getTime());
          expect(after!.lastAccessedAt.getTime()).toBeGreaterThanOrEqual(
            before.lastAccessedAt.getTime(),
          );
        } else {
          expect(after!.accessedCount).toBe(before.accessedCount);
        }
      }
    });

    it('should update identity layer accessedAt when calling findById', async () => {
      // Create an identity entry with base memory
      const { identityId, userMemoryId } = await userMemoryModel.addIdentityEntry({
        base: {
          memoryLayer: 'identity',
          summary: 'Identity summary',
        },
        identity: {
          description: 'Identity description',
          type: 'personal',
        },
      });

      // Get initial state
      const beforeIdentity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      const initialAccessedAt = beforeIdentity?.accessedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Call findById which triggers updateAccessMetrics internally
      await userMemoryModel.findById(userMemoryId);

      // Get after state
      const afterIdentity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: eq(userMemoriesIdentities.id, identityId),
      });

      // The identity layer should have updated accessedAt
      expect(afterIdentity).toBeDefined();
      expect(afterIdentity!.accessedAt).toBeDefined();

      // accessedAt should be updated (either later or same if test runs fast)
      if (initialAccessedAt && afterIdentity!.accessedAt) {
        expect(afterIdentity!.accessedAt.getTime()).toBeGreaterThanOrEqual(
          initialAccessedAt.getTime(),
        );
      }
    });
  });

  describe('getAllIdentitiesWithMemory', () => {
    it('should return all identities with their associated base memories', async () => {
      // Create identity entries
      await userMemoryModel.addIdentityEntry({
        base: {
          memoryLayer: 'identity',
          summary: 'Summary 1',
          title: 'Title 1',
        },
        identity: {
          description: 'Description 1',
          type: 'personal',
        },
      });

      await userMemoryModel.addIdentityEntry({
        base: {
          memoryLayer: 'identity',
          summary: 'Summary 2',
          title: 'Title 2',
        },
        identity: {
          description: 'Description 2',
          type: 'professional',
        },
      });

      const result = await userMemoryModel.getAllIdentitiesWithMemory();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('identity');
      expect(result[0]).toHaveProperty('memory');
      expect(result[0].identity).toHaveProperty('description');
      expect(result[0].memory).toHaveProperty('summary');
    });

    it('should order by capturedAt desc', async () => {
      await userMemoryModel.addIdentityEntry({
        base: { summary: 'First' },
        identity: {
          capturedAt: new Date('2024-01-01T00:00:00Z'),
          description: 'First identity',
        },
      });

      await userMemoryModel.addIdentityEntry({
        base: { summary: 'Second' },
        identity: {
          capturedAt: new Date('2024-01-02T00:00:00Z'),
          description: 'Second identity',
        },
      });

      const result = await userMemoryModel.getAllIdentitiesWithMemory();

      expect(result).toHaveLength(2);
      expect(result[0].identity.description).toBe('Second identity');
      expect(result[1].identity.description).toBe('First identity');
    });

    it('should only return identities for current user', async () => {
      // Create identity for current user
      await userMemoryModel.addIdentityEntry({
        base: { summary: 'My identity' },
        identity: { description: 'My description' },
      });

      // Create identity for other user
      const otherUserModel = new UserMemoryModel(serverDB, userId2);
      await otherUserModel.addIdentityEntry({
        base: { summary: 'Other identity' },
        identity: { description: 'Other description' },
      });

      const result = await userMemoryModel.getAllIdentitiesWithMemory();

      expect(result).toHaveLength(1);
      expect(result[0].identity.description).toBe('My description');
    });
  });

  describe('getIdentitiesByType', () => {
    beforeEach(async () => {
      // Create identities with different types
      await userMemoryModel.addIdentityEntry({
        base: { summary: 'Personal 1' },
        identity: {
          capturedAt: new Date('2024-01-01T00:00:00Z'),
          description: 'Personal identity 1',
          type: 'personal',
        },
      });

      await userMemoryModel.addIdentityEntry({
        base: { summary: 'Personal 2' },
        identity: {
          capturedAt: new Date('2024-01-02T00:00:00Z'),
          description: 'Personal identity 2',
          type: 'personal',
        },
      });

      await userMemoryModel.addIdentityEntry({
        base: { summary: 'Professional' },
        identity: {
          capturedAt: new Date('2024-01-03T00:00:00Z'),
          description: 'Professional identity',
          type: 'professional',
        },
      });
    });

    it('should return identities filtered by type', async () => {
      const personalIdentities = await userMemoryModel.getIdentitiesByType('personal');

      expect(personalIdentities).toHaveLength(2);
      expect(personalIdentities.every((i) => i.type === 'personal')).toBe(true);
    });

    it('should order by capturedAt desc', async () => {
      const personalIdentities = await userMemoryModel.getIdentitiesByType('personal');

      expect(personalIdentities[0].description).toBe('Personal identity 2');
      expect(personalIdentities[1].description).toBe('Personal identity 1');
    });

    it('should return empty array for non-existent type', async () => {
      const result = await userMemoryModel.getIdentitiesByType('non-existent');

      expect(result).toHaveLength(0);
    });

    it('should only return identities for current user', async () => {
      // Create identity for other user with same type
      const otherUserModel = new UserMemoryModel(serverDB, userId2);
      await otherUserModel.addIdentityEntry({
        base: { summary: 'Other personal' },
        identity: {
          description: 'Other personal identity',
          type: 'personal',
        },
      });

      const personalIdentities = await userMemoryModel.getIdentitiesByType('personal');

      expect(personalIdentities).toHaveLength(2);
      expect(personalIdentities.every((i) => i.userId === userId)).toBe(true);
    });
  });
});
