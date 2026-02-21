// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { NewUserMemoryExperience } from '../../../schemas';
import { userMemories, userMemoriesExperiences, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
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

  describe('queryList', () => {
    beforeEach(async () => {
      // Create user memories for joining
      await serverDB.insert(userMemories).values([
        {
          id: 'exp-memory-1',
          userId,
          title: 'Experience Memory 1',
          lastAccessedAt: new Date(),
        },
        {
          id: 'exp-memory-2',
          userId,
          title: 'Experience Memory 2',
          lastAccessedAt: new Date(),
        },
        {
          id: 'exp-memory-3',
          userId,
          title: 'Searchable Title',
          lastAccessedAt: new Date(),
        },
        {
          id: 'other-exp-memory',
          userId: otherUserId,
          title: 'Other Memory',
          lastAccessedAt: new Date(),
        },
      ]);

      // Create test experiences with user memories
      await serverDB.insert(userMemoriesExperiences).values([
        {
          id: 'list-exp-1',
          userId,
          userMemoryId: 'exp-memory-1',
          type: 'lesson',
          situation: 'First situation',
          keyLearning: 'First key learning',
          action: 'First action',
          tags: ['tag1'],
          scoreConfidence: 0.8,
          capturedAt: new Date('2024-01-15T10:00:00Z'),
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'list-exp-2',
          userId,
          userMemoryId: 'exp-memory-2',
          type: 'insight',
          situation: 'Second situation',
          keyLearning: 'Second key learning',
          action: 'Searchable action content',
          tags: ['tag2'],
          scoreConfidence: 0.9,
          capturedAt: new Date('2024-01-16T10:00:00Z'),
          createdAt: new Date('2024-01-02T10:00:00Z'),
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'list-exp-3',
          userId,
          userMemoryId: 'exp-memory-3',
          type: 'lesson',
          situation: 'Searchable situation content',
          keyLearning: 'Searchable learning',
          tags: [],
          scoreConfidence: 0.7,
          capturedAt: new Date('2024-01-17T10:00:00Z'),
          createdAt: new Date('2024-01-03T10:00:00Z'),
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
        {
          id: 'other-list-exp',
          userId: otherUserId,
          userMemoryId: 'other-exp-memory',
          type: 'lesson',
          situation: 'Other user experience',
          capturedAt: new Date('2024-01-18T10:00:00Z'),
          createdAt: new Date('2024-01-04T10:00:00Z'),
        },
      ]);
    });

    it('should return paginated list with default parameters', async () => {
      const result = await experienceModel.queryList();

      expect(result.items).toHaveLength(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.total).toBe(3);
    });

    it('should return correct page and pageSize', async () => {
      const result = await experienceModel.queryList({ page: 1, pageSize: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.total).toBe(3);
    });

    it('should return second page correctly', async () => {
      const result = await experienceModel.queryList({ page: 2, pageSize: 2 });

      expect(result.items).toHaveLength(1);
      expect(result.page).toBe(2);
    });

    it('should normalize invalid page to 1', async () => {
      const result = await experienceModel.queryList({ page: -1 });

      expect(result.page).toBe(1);
    });

    it('should cap pageSize at 100', async () => {
      const result = await experienceModel.queryList({ pageSize: 200 });

      expect(result.pageSize).toBe(100);
    });

    it('should search by query in title', async () => {
      const result = await experienceModel.queryList({ q: 'Searchable Title' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-exp-3');
    });

    it('should search by query in situation', async () => {
      const result = await experienceModel.queryList({ q: 'Searchable situation' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-exp-3');
    });

    it('should search by query in keyLearning', async () => {
      const result = await experienceModel.queryList({ q: 'Searchable learning' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-exp-3');
    });

    it('should search by query in action', async () => {
      const result = await experienceModel.queryList({ q: 'Searchable action' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-exp-2');
    });

    it('should filter by types', async () => {
      const result = await experienceModel.queryList({ types: ['lesson'] });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.type === 'lesson')).toBe(true);
    });

    it('should filter by multiple types', async () => {
      const result = await experienceModel.queryList({ types: ['lesson', 'insight'] });

      expect(result.items).toHaveLength(3);
    });

    it('should filter by tags', async () => {
      const result = await experienceModel.queryList({ tags: ['tag1'] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-exp-1');
    });

    it('should sort by capturedAt desc by default', async () => {
      const result = await experienceModel.queryList({ order: 'desc' });

      expect(result.items[0].id).toBe('list-exp-3');
      expect(result.items[2].id).toBe('list-exp-1');
    });

    it('should sort by capturedAt asc', async () => {
      const result = await experienceModel.queryList({ order: 'asc' });

      expect(result.items[0].id).toBe('list-exp-1');
      expect(result.items[2].id).toBe('list-exp-3');
    });

    it('should sort by scoreConfidence', async () => {
      const result = await experienceModel.queryList({ sort: 'scoreConfidence', order: 'desc' });

      expect(result.items[0].id).toBe('list-exp-2'); // 0.9
      expect(result.items[1].id).toBe('list-exp-1'); // 0.8
      expect(result.items[2].id).toBe('list-exp-3'); // 0.7
    });

    it('should not return other users experiences', async () => {
      const result = await experienceModel.queryList();

      const otherExperience = result.items.find((e) => e.id === 'other-list-exp');
      expect(otherExperience).toBeUndefined();
    });

    it('should return correct fields structure', async () => {
      const result = await experienceModel.queryList({ pageSize: 1 });

      expect(result.items[0]).toHaveProperty('id');
      expect(result.items[0]).toHaveProperty('title');
      expect(result.items[0]).toHaveProperty('situation');
      expect(result.items[0]).toHaveProperty('keyLearning');
      expect(result.items[0]).toHaveProperty('action');
      expect(result.items[0]).toHaveProperty('type');
      expect(result.items[0]).toHaveProperty('tags');
      expect(result.items[0]).toHaveProperty('scoreConfidence');
      expect(result.items[0]).toHaveProperty('capturedAt');
      expect(result.items[0]).toHaveProperty('createdAt');
      expect(result.items[0]).toHaveProperty('updatedAt');
    });

    it('should handle empty query string', async () => {
      const result = await experienceModel.queryList({ q: '   ' });

      expect(result.items).toHaveLength(3);
    });
  });
});
