// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { NewUserMemoryPreference } from '../../../schemas';
import { userMemories, userMemoriesPreferences, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryPreferenceModel } from '../preference';

const userId = 'preference-test-user';
const otherUserId = 'other-preference-user';

let preferenceModel: UserMemoryPreferenceModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize model
  preferenceModel = new UserMemoryPreferenceModel(serverDB, userId);
});

describe('UserMemoryPreferenceModel', () => {
  describe('create', () => {
    it('should create a new preference', async () => {
      const preferenceData: Omit<NewUserMemoryPreference, 'userId'> = {
        type: 'communication',
        conclusionDirectives: 'Prefer concise responses',
        suggestions: 'Use bullet points when possible',
      };

      const result = await preferenceModel.create(preferenceData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.type).toBe('communication');
      expect(result.conclusionDirectives).toBe('Prefer concise responses');
      expect(result.suggestions).toBe('Use bullet points when possible');
    });

    it('should auto-assign userId from model', async () => {
      const result = await preferenceModel.create({
        type: 'style',
        conclusionDirectives: 'Test directive',
      });

      expect(result.userId).toBe(userId);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test preferences
      await serverDB.insert(userMemoriesPreferences).values([
        {
          id: 'preference-1',
          userId,
          type: 'communication',
          conclusionDirectives: 'Directive 1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'preference-2',
          userId,
          type: 'style',
          conclusionDirectives: 'Directive 2',
          createdAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'other-preference',
          userId: otherUserId,
          type: 'communication',
          conclusionDirectives: 'Other Directive',
          createdAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
    });

    it('should return preferences for current user only', async () => {
      const result = await preferenceModel.query();

      expect(result).toHaveLength(2);
      expect(result.every((p) => p.userId === userId)).toBe(true);
    });

    it('should order by createdAt desc', async () => {
      const result = await preferenceModel.query();

      expect(result[0].id).toBe('preference-2'); // Most recent first
      expect(result[1].id).toBe('preference-1');
    });

    it('should respect limit parameter', async () => {
      const result = await preferenceModel.query(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('preference-2');
    });

    it('should not return other users preferences', async () => {
      const result = await preferenceModel.query();

      const otherPreference = result.find((p) => p.id === 'other-preference');
      expect(otherPreference).toBeUndefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesPreferences).values([
        {
          id: 'find-preference-1',
          userId,
          type: 'communication',
          conclusionDirectives: 'Find Directive 1',
        },
        {
          id: 'find-preference-other',
          userId: otherUserId,
          type: 'communication',
          conclusionDirectives: 'Other Directive',
        },
      ]);
    });

    it('should find preference by ID for current user', async () => {
      const result = await preferenceModel.findById('find-preference-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('find-preference-1');
      expect(result?.conclusionDirectives).toBe('Find Directive 1');
    });

    it('should return undefined for non-existent preference', async () => {
      const result = await preferenceModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not find preferences belonging to other users', async () => {
      const result = await preferenceModel.findById('find-preference-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesPreferences).values([
        {
          id: 'update-preference',
          userId,
          type: 'communication',
          conclusionDirectives: 'Original Directive',
          suggestions: 'Original Suggestion',
        },
        {
          id: 'other-user-preference',
          userId: otherUserId,
          type: 'communication',
          conclusionDirectives: 'Other Directive',
        },
      ]);
    });

    it('should update preference', async () => {
      await preferenceModel.update('update-preference', {
        conclusionDirectives: 'Updated Directive',
        suggestions: 'Updated Suggestion',
      });

      const updated = await preferenceModel.findById('update-preference');
      expect(updated?.conclusionDirectives).toBe('Updated Directive');
      expect(updated?.suggestions).toBe('Updated Suggestion');
    });

    it('should not update preferences belonging to other users', async () => {
      await preferenceModel.update('other-user-preference', {
        conclusionDirectives: 'Hacked Directive',
      });

      // Verify the other user's preference was not updated
      const result = await serverDB.query.userMemoriesPreferences.findFirst({
        where: (p, { eq }) => eq(p.id, 'other-user-preference'),
      });
      expect(result?.conclusionDirectives).toBe('Other Directive');
    });
  });

  describe('delete', () => {
    it('should delete preference and associated user memory', async () => {
      // Create a user memory first
      const [memory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'preference-memory',
          userId,
          title: 'Preference Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      // Create preference with associated memory
      await serverDB.insert(userMemoriesPreferences).values({
        id: 'delete-preference',
        userId,
        type: 'communication',
        conclusionDirectives: 'Preference to Delete',
        userMemoryId: memory.id,
      });

      const result = await preferenceModel.delete('delete-preference');

      expect(result.success).toBe(true);

      // Verify preference was deleted
      const deletedPreference = await preferenceModel.findById('delete-preference');
      expect(deletedPreference).toBeUndefined();

      // Verify associated memory was also deleted
      const deletedMemory = await serverDB.query.userMemories.findFirst({
        where: (m, { eq }) => eq(m.id, 'preference-memory'),
      });
      expect(deletedMemory).toBeUndefined();
    });

    it('should return success: false for non-existent preference', async () => {
      const result = await preferenceModel.delete('non-existent');

      expect(result.success).toBe(false);
    });

    it('should return success: false for preference without userMemoryId', async () => {
      await serverDB.insert(userMemoriesPreferences).values({
        id: 'no-memory-preference',
        userId,
        type: 'communication',
        conclusionDirectives: 'No memory linked',
        userMemoryId: null,
      });

      const result = await preferenceModel.delete('no-memory-preference');

      expect(result.success).toBe(false);
    });

    it('should not delete preferences belonging to other users', async () => {
      // Create memory for other user
      const [otherMemory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'other-preference-memory',
          userId: otherUserId,
          title: 'Other Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      await serverDB.insert(userMemoriesPreferences).values({
        id: 'other-delete-preference',
        userId: otherUserId,
        type: 'communication',
        conclusionDirectives: 'Other Preference',
        userMemoryId: otherMemory.id,
      });

      const result = await preferenceModel.delete('other-delete-preference');

      expect(result.success).toBe(false);

      // Verify the preference still exists
      const stillExists = await serverDB.query.userMemoriesPreferences.findFirst({
        where: (p, { eq }) => eq(p.id, 'other-delete-preference'),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesPreferences).values([
        {
          id: 'user-preference-1',
          userId,
          type: 'communication',
          conclusionDirectives: 'User Preference 1',
        },
        {
          id: 'user-preference-2',
          userId,
          type: 'style',
          conclusionDirectives: 'User Preference 2',
        },
        {
          id: 'other-preference',
          userId: otherUserId,
          type: 'communication',
          conclusionDirectives: 'Other Preference',
        },
      ]);
    });

    it('should delete all preferences for current user only', async () => {
      await preferenceModel.deleteAll();

      // Verify user's preferences were deleted
      const userPreferences = await preferenceModel.query();
      expect(userPreferences).toHaveLength(0);

      // Verify other user's preference still exists
      const otherPreference = await serverDB.query.userMemoriesPreferences.findFirst({
        where: (p, { eq }) => eq(p.id, 'other-preference'),
      });
      expect(otherPreference).toBeDefined();
    });
  });
});
