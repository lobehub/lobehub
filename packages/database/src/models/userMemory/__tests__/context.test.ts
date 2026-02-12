// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { NewUserMemoryContext } from '../../../schemas';
import { userMemories, userMemoriesContexts, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryContextModel } from '../context';

const userId = 'context-test-user';
const otherUserId = 'other-context-user';

let contextModel: UserMemoryContextModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize model
  contextModel = new UserMemoryContextModel(serverDB, userId);
});

describe('UserMemoryContextModel', () => {
  describe('create', () => {
    it('should create a new context', async () => {
      const contextData: Omit<NewUserMemoryContext, 'userId'> = {
        title: 'Test Context',
        description: 'Test context description',
        type: 'work',
        currentStatus: 'active',
      };

      const result = await contextModel.create(contextData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.title).toBe('Test Context');
      expect(result.description).toBe('Test context description');
      expect(result.type).toBe('work');
      expect(result.currentStatus).toBe('active');
    });

    it('should auto-assign userId from model', async () => {
      const result = await contextModel.create({
        title: 'User Context',
      });

      expect(result.userId).toBe(userId);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test contexts
      await serverDB.insert(userMemoriesContexts).values([
        {
          id: 'context-1',
          userId,
          title: 'Context 1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'context-2',
          userId,
          title: 'Context 2',
          createdAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'other-context',
          userId: otherUserId,
          title: 'Other User Context',
          createdAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
    });

    it('should return contexts for current user only', async () => {
      const result = await contextModel.query();

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.userId === userId)).toBe(true);
    });

    it('should order by createdAt desc', async () => {
      const result = await contextModel.query();

      expect(result[0].id).toBe('context-2'); // Most recent first
      expect(result[1].id).toBe('context-1');
    });

    it('should respect limit parameter', async () => {
      const result = await contextModel.query(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('context-2');
    });

    it('should not return other users contexts', async () => {
      const result = await contextModel.query();

      const otherContext = result.find((c) => c.id === 'other-context');
      expect(otherContext).toBeUndefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesContexts).values([
        {
          id: 'find-context-1',
          userId,
          title: 'Find Context 1',
        },
        {
          id: 'find-context-other',
          userId: otherUserId,
          title: 'Other User Context',
        },
      ]);
    });

    it('should find context by ID for current user', async () => {
      const result = await contextModel.findById('find-context-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('find-context-1');
      expect(result?.title).toBe('Find Context 1');
    });

    it('should return undefined for non-existent context', async () => {
      const result = await contextModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not find contexts belonging to other users', async () => {
      const result = await contextModel.findById('find-context-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesContexts).values([
        {
          id: 'update-context',
          userId,
          title: 'Original Title',
          description: 'Original description',
        },
        {
          id: 'other-user-context',
          userId: otherUserId,
          title: 'Other User Context',
        },
      ]);
    });

    it('should update context', async () => {
      await contextModel.update('update-context', {
        title: 'Updated Title',
        description: 'Updated description',
      });

      const updated = await contextModel.findById('update-context');
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('Updated description');
    });

    it('should not update contexts belonging to other users', async () => {
      await contextModel.update('other-user-context', {
        title: 'Hacked Title',
      });

      // Verify the other user's context was not updated
      const result = await serverDB.query.userMemoriesContexts.findFirst({
        where: (c, { eq }) => eq(c.id, 'other-user-context'),
      });
      expect(result?.title).toBe('Other User Context');
    });
  });

  describe('delete', () => {
    it('should delete context and associated user memories', async () => {
      // Create a user memory first
      const [memory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'associated-memory',
          userId,
          title: 'Associated Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      // Create context with associated memory
      await serverDB.insert(userMemoriesContexts).values({
        id: 'delete-context',
        userId,
        title: 'Context to Delete',
        userMemoryIds: [memory.id],
      });

      const result = await contextModel.delete('delete-context');

      expect(result.success).toBe(true);

      // Verify context was deleted
      const deletedContext = await contextModel.findById('delete-context');
      expect(deletedContext).toBeUndefined();

      // Verify associated memory was also deleted
      const deletedMemory = await serverDB.query.userMemories.findFirst({
        where: (m, { eq }) => eq(m.id, 'associated-memory'),
      });
      expect(deletedMemory).toBeUndefined();
    });

    it('should return success: false for non-existent context', async () => {
      const result = await contextModel.delete('non-existent');

      expect(result.success).toBe(false);
    });

    it('should not delete contexts belonging to other users', async () => {
      await serverDB.insert(userMemoriesContexts).values({
        id: 'other-delete-context',
        userId: otherUserId,
        title: 'Other User Context',
      });

      const result = await contextModel.delete('other-delete-context');

      expect(result.success).toBe(false);

      // Verify the context still exists
      const stillExists = await serverDB.query.userMemoriesContexts.findFirst({
        where: (c, { eq }) => eq(c.id, 'other-delete-context'),
      });
      expect(stillExists).toBeDefined();
    });

    it('should handle context without associated memories', async () => {
      await serverDB.insert(userMemoriesContexts).values({
        id: 'no-memories-context',
        userId,
        title: 'Context without memories',
        userMemoryIds: [],
      });

      const result = await contextModel.delete('no-memories-context');

      expect(result.success).toBe(true);
    });
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesContexts).values([
        { id: 'user-context-1', userId, title: 'User Context 1' },
        { id: 'user-context-2', userId, title: 'User Context 2' },
        { id: 'other-context', userId: otherUserId, title: 'Other Context' },
      ]);
    });

    it('should delete all contexts for current user only', async () => {
      await contextModel.deleteAll();

      // Verify user's contexts were deleted
      const userContexts = await contextModel.query();
      expect(userContexts).toHaveLength(0);

      // Verify other user's context still exists
      const otherContext = await serverDB.query.userMemoriesContexts.findFirst({
        where: (c, { eq }) => eq(c.id, 'other-context'),
      });
      expect(otherContext).toBeDefined();
    });
  });
});
