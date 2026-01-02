// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import {
  NewUserMemoryExperience,
  userMemories,
  userMemoriesExperiences,
  users,
} from '../../../schemas';
import { LobeChatDatabase } from '../../../type';
import { getTestDB } from '../../__tests__/_util';
import { UserMemoryExperienceModel } from '../experience';

const userId = 'experience-test-user';
const otherUserId = 'other-experience-user';

let experienceModel: UserMemoryExperienceModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize model
  experienceModel = new UserMemoryExperienceModel(serverDB, userId);
});

describe('UserMemoryExperienceModel', () => {
  describe('create', () => {
    it('should create a new experience', async () => {
      const experienceData: Omit<NewUserMemoryExperience, 'userId'> = {
        type: 'lesson',
        situation: 'When debugging code',
        reasoning: 'Checking logs helps identify issues',
        action: 'Read logs first',
        keyLearning: 'Always check logs before debugging',
      };

      const result = await experienceModel.create(experienceData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.type).toBe('lesson');
      expect(result.situation).toBe('When debugging code');
      expect(result.action).toBe('Read logs first');
    });

    it('should auto-assign userId from model', async () => {
      const result = await experienceModel.create({
        type: 'insight',
        situation: 'Test situation',
      });

      expect(result.userId).toBe(userId);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test experiences
      await serverDB.insert(userMemoriesExperiences).values([
        {
          id: 'experience-1',
          userId,
          type: 'lesson',
          situation: 'Situation 1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'experience-2',
          userId,
          type: 'insight',
          situation: 'Situation 2',
          createdAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'other-experience',
          userId: otherUserId,
          type: 'lesson',
          situation: 'Other Situation',
          createdAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
    });

    it('should return experiences for current user only', async () => {
      const result = await experienceModel.query();

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.userId === userId)).toBe(true);
    });

    it('should order by createdAt desc', async () => {
      const result = await experienceModel.query();

      expect(result[0].id).toBe('experience-2'); // Most recent first
      expect(result[1].id).toBe('experience-1');
    });

    it('should respect limit parameter', async () => {
      const result = await experienceModel.query(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('experience-2');
    });

    it('should not return other users experiences', async () => {
      const result = await experienceModel.query();

      const otherExperience = result.find((e) => e.id === 'other-experience');
      expect(otherExperience).toBeUndefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesExperiences).values([
        {
          id: 'find-experience-1',
          userId,
          type: 'lesson',
          situation: 'Find Situation 1',
        },
        {
          id: 'find-experience-other',
          userId: otherUserId,
          type: 'lesson',
          situation: 'Other Situation',
        },
      ]);
    });

    it('should find experience by ID for current user', async () => {
      const result = await experienceModel.findById('find-experience-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('find-experience-1');
      expect(result?.situation).toBe('Find Situation 1');
    });

    it('should return undefined for non-existent experience', async () => {
      const result = await experienceModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not find experiences belonging to other users', async () => {
      const result = await experienceModel.findById('find-experience-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesExperiences).values([
        {
          id: 'update-experience',
          userId,
          type: 'lesson',
          situation: 'Original Situation',
          action: 'Original Action',
        },
        {
          id: 'other-user-experience',
          userId: otherUserId,
          type: 'lesson',
          situation: 'Other Situation',
        },
      ]);
    });

    it('should update experience', async () => {
      await experienceModel.update('update-experience', {
        situation: 'Updated Situation',
        action: 'Updated Action',
      });

      const updated = await experienceModel.findById('update-experience');
      expect(updated?.situation).toBe('Updated Situation');
      expect(updated?.action).toBe('Updated Action');
    });

    it('should not update experiences belonging to other users', async () => {
      await experienceModel.update('other-user-experience', {
        situation: 'Hacked Situation',
      });

      // Verify the other user's experience was not updated
      const result = await serverDB.query.userMemoriesExperiences.findFirst({
        where: (e, { eq }) => eq(e.id, 'other-user-experience'),
      });
      expect(result?.situation).toBe('Other Situation');
    });
  });

  describe('delete', () => {
    it('should delete experience and associated user memory', async () => {
      // Create a user memory first
      const [memory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'experience-memory',
          userId,
          title: 'Experience Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      // Create experience with associated memory
      await serverDB.insert(userMemoriesExperiences).values({
        id: 'delete-experience',
        userId,
        type: 'lesson',
        situation: 'Experience to Delete',
        userMemoryId: memory.id,
      });

      const result = await experienceModel.delete('delete-experience');

      expect(result.success).toBe(true);

      // Verify experience was deleted
      const deletedExperience = await experienceModel.findById('delete-experience');
      expect(deletedExperience).toBeUndefined();

      // Verify associated memory was also deleted
      const deletedMemory = await serverDB.query.userMemories.findFirst({
        where: (m, { eq }) => eq(m.id, 'experience-memory'),
      });
      expect(deletedMemory).toBeUndefined();
    });

    it('should return success: false for non-existent experience', async () => {
      const result = await experienceModel.delete('non-existent');

      expect(result.success).toBe(false);
    });

    it('should return success: false for experience without userMemoryId', async () => {
      await serverDB.insert(userMemoriesExperiences).values({
        id: 'no-memory-experience',
        userId,
        type: 'lesson',
        situation: 'No memory linked',
        userMemoryId: null,
      });

      const result = await experienceModel.delete('no-memory-experience');

      expect(result.success).toBe(false);
    });

    it('should not delete experiences belonging to other users', async () => {
      // Create memory for other user
      const [otherMemory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'other-experience-memory',
          userId: otherUserId,
          title: 'Other Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      await serverDB.insert(userMemoriesExperiences).values({
        id: 'other-delete-experience',
        userId: otherUserId,
        type: 'lesson',
        situation: 'Other Experience',
        userMemoryId: otherMemory.id,
      });

      const result = await experienceModel.delete('other-delete-experience');

      expect(result.success).toBe(false);

      // Verify the experience still exists
      const stillExists = await serverDB.query.userMemoriesExperiences.findFirst({
        where: (e, { eq }) => eq(e.id, 'other-delete-experience'),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesExperiences).values([
        { id: 'user-experience-1', userId, type: 'lesson', situation: 'User Experience 1' },
        { id: 'user-experience-2', userId, type: 'insight', situation: 'User Experience 2' },
        {
          id: 'other-experience',
          userId: otherUserId,
          type: 'lesson',
          situation: 'Other Experience',
        },
      ]);
    });

    it('should delete all experiences for current user only', async () => {
      await experienceModel.deleteAll();

      // Verify user's experiences were deleted
      const userExperiences = await experienceModel.query();
      expect(userExperiences).toHaveLength(0);

      // Verify other user's experience still exists
      const otherExperience = await serverDB.query.userMemoriesExperiences.findFirst({
        where: (e, { eq }) => eq(e.id, 'other-experience'),
      });
      expect(otherExperience).toBeDefined();
    });
  });
});
