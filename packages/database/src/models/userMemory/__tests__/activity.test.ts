// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { NewUserMemoryActivity } from '../../../schemas';
import { userMemories, userMemoriesActivities, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryActivityModel } from '../activity';

const userId = 'activity-test-user';
const otherUserId = 'other-activity-user';

let activityModel: UserMemoryActivityModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize model
  activityModel = new UserMemoryActivityModel(serverDB, userId);
});

describe('UserMemoryActivityModel', () => {
  describe('create', () => {
    it('should create a new activity', async () => {
      const activityData: Omit<NewUserMemoryActivity, 'userId'> = {
        type: 'event',
        narrative: 'User attended a conference',
        notes: 'Met interesting people',
        startsAt: new Date('2024-01-15T09:00:00Z'),
        endsAt: new Date('2024-01-15T17:00:00Z'),
      };

      const result = await activityModel.create(activityData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.type).toBe('event');
      expect(result.narrative).toBe('User attended a conference');
      expect(result.notes).toBe('Met interesting people');
    });

    it('should auto-assign userId from model', async () => {
      const result = await activityModel.create({
        type: 'task',
        narrative: 'Test activity',
      });

      expect(result.userId).toBe(userId);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test activities
      await serverDB.insert(userMemoriesActivities).values([
        {
          id: 'activity-1',
          userId,
          type: 'event',
          narrative: 'Activity 1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'activity-2',
          userId,
          type: 'task',
          narrative: 'Activity 2',
          createdAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'other-activity',
          userId: otherUserId,
          type: 'event',
          narrative: 'Other Activity',
          createdAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
    });

    it('should return activities for current user only', async () => {
      const result = await activityModel.query();

      expect(result).toHaveLength(2);
      expect(result.every((a) => a.userId === userId)).toBe(true);
    });

    it('should order by createdAt desc', async () => {
      const result = await activityModel.query();

      expect(result[0].id).toBe('activity-2'); // Most recent first
      expect(result[1].id).toBe('activity-1');
    });

    it('should respect limit parameter', async () => {
      const result = await activityModel.query(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('activity-2');
    });

    it('should not return other users activities', async () => {
      const result = await activityModel.query();

      const otherActivity = result.find((a) => a.id === 'other-activity');
      expect(otherActivity).toBeUndefined();
    });
  });

  describe('queryList', () => {
    beforeEach(async () => {
      // Create user memories for joining
      await serverDB.insert(userMemories).values([
        {
          id: 'memory-1',
          userId,
          title: 'Memory Title 1',
          tags: ['work', 'meeting'],
          lastAccessedAt: new Date(),
        },
        {
          id: 'memory-2',
          userId,
          title: 'Memory Title 2',
          tags: ['personal'],
          lastAccessedAt: new Date(),
        },
        {
          id: 'memory-3',
          userId,
          title: 'Search Test Memory',
          tags: [],
          lastAccessedAt: new Date(),
        },
        {
          id: 'other-memory',
          userId: otherUserId,
          title: 'Other Memory',
          tags: [],
          lastAccessedAt: new Date(),
        },
      ]);

      // Create test activities with user memories
      await serverDB.insert(userMemoriesActivities).values([
        {
          id: 'list-activity-1',
          userId,
          userMemoryId: 'memory-1',
          type: 'event',
          status: 'completed',
          narrative: 'First activity narrative',
          notes: 'Some notes',
          tags: ['tag1'],
          startsAt: new Date('2024-01-15T09:00:00Z'),
          capturedAt: new Date('2024-01-15T10:00:00Z'),
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'list-activity-2',
          userId,
          userMemoryId: 'memory-2',
          type: 'task',
          status: 'pending',
          narrative: 'Second activity narrative',
          feedback: 'Some feedback',
          tags: ['tag2'],
          startsAt: new Date('2024-01-16T09:00:00Z'),
          capturedAt: new Date('2024-01-16T10:00:00Z'),
          createdAt: new Date('2024-01-02T10:00:00Z'),
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'list-activity-3',
          userId,
          userMemoryId: 'memory-3',
          type: 'event',
          status: 'completed',
          narrative: 'Searchable narrative content',
          tags: [],
          capturedAt: new Date('2024-01-17T10:00:00Z'),
          createdAt: new Date('2024-01-03T10:00:00Z'),
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
        {
          id: 'other-list-activity',
          userId: otherUserId,
          userMemoryId: 'other-memory',
          type: 'event',
          narrative: 'Other user activity',
          capturedAt: new Date('2024-01-18T10:00:00Z'),
          createdAt: new Date('2024-01-04T10:00:00Z'),
        },
      ]);
    });

    it('should return paginated list with default parameters', async () => {
      const result = await activityModel.queryList();

      expect(result.items).toHaveLength(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.total).toBe(3);
    });

    it('should return correct page and pageSize', async () => {
      const result = await activityModel.queryList({ page: 1, pageSize: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.total).toBe(3);
    });

    it('should return second page correctly', async () => {
      const result = await activityModel.queryList({ page: 2, pageSize: 2 });

      expect(result.items).toHaveLength(1);
      expect(result.page).toBe(2);
    });

    it('should normalize invalid page to 1', async () => {
      const result = await activityModel.queryList({ page: -1 });

      expect(result.page).toBe(1);
    });

    it('should cap pageSize at 100', async () => {
      const result = await activityModel.queryList({ pageSize: 200 });

      expect(result.pageSize).toBe(100);
    });

    it('should search by query in title', async () => {
      const result = await activityModel.queryList({ q: 'Search Test' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-activity-3');
    });

    it('should search by query in narrative', async () => {
      const result = await activityModel.queryList({ q: 'Searchable narrative' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-activity-3');
    });

    it('should search by query in notes', async () => {
      const result = await activityModel.queryList({ q: 'Some notes' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-activity-1');
    });

    it('should search by query in feedback', async () => {
      const result = await activityModel.queryList({ q: 'Some feedback' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-activity-2');
    });

    it('should filter by types', async () => {
      const result = await activityModel.queryList({ types: ['event'] });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((a) => a.type === 'event')).toBe(true);
    });

    it('should filter by multiple types', async () => {
      const result = await activityModel.queryList({ types: ['event', 'task'] });

      expect(result.items).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const result = await activityModel.queryList({ status: ['completed'] });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((a) => a.status === 'completed')).toBe(true);
    });

    it('should filter by tags', async () => {
      const result = await activityModel.queryList({ tags: ['tag1'] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-activity-1');
    });

    it('should filter by memory tags', async () => {
      const result = await activityModel.queryList({ tags: ['work'] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('list-activity-1');
    });

    it('should sort by capturedAt desc by default', async () => {
      const result = await activityModel.queryList({ order: 'desc' });

      expect(result.items[0].id).toBe('list-activity-3');
      expect(result.items[2].id).toBe('list-activity-1');
    });

    it('should sort by capturedAt asc', async () => {
      const result = await activityModel.queryList({ order: 'asc' });

      expect(result.items[0].id).toBe('list-activity-1');
      expect(result.items[2].id).toBe('list-activity-3');
    });

    it('should sort by startsAt', async () => {
      const result = await activityModel.queryList({ sort: 'startsAt', order: 'asc' });

      // list-activity-1 has startsAt 2024-01-15, list-activity-2 has 2024-01-16
      // list-activity-3 has no startsAt (NULL)
      expect(result.items[0].id).toBe('list-activity-1');
      expect(result.items[1].id).toBe('list-activity-2');
    });

    it('should not return other users activities', async () => {
      const result = await activityModel.queryList();

      const otherActivity = result.items.find((a) => a.id === 'other-list-activity');
      expect(otherActivity).toBeUndefined();
    });

    it('should return correct fields structure', async () => {
      const result = await activityModel.queryList({ pageSize: 1 });

      expect(result.items[0]).toHaveProperty('id');
      expect(result.items[0]).toHaveProperty('title');
      expect(result.items[0]).toHaveProperty('narrative');
      expect(result.items[0]).toHaveProperty('type');
      expect(result.items[0]).toHaveProperty('status');
      expect(result.items[0]).toHaveProperty('tags');
      expect(result.items[0]).toHaveProperty('capturedAt');
      expect(result.items[0]).toHaveProperty('startsAt');
      expect(result.items[0]).toHaveProperty('endsAt');
      expect(result.items[0]).toHaveProperty('createdAt');
      expect(result.items[0]).toHaveProperty('updatedAt');
    });

    it('should handle empty query string', async () => {
      const result = await activityModel.queryList({ q: '   ' });

      expect(result.items).toHaveLength(3);
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesActivities).values([
        {
          id: 'find-activity-1',
          userId,
          type: 'event',
          narrative: 'Find Activity 1',
        },
        {
          id: 'find-activity-other',
          userId: otherUserId,
          type: 'event',
          narrative: 'Other Activity',
        },
      ]);
    });

    it('should find activity by ID for current user', async () => {
      const result = await activityModel.findById('find-activity-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('find-activity-1');
      expect(result?.narrative).toBe('Find Activity 1');
    });

    it('should return undefined for non-existent activity', async () => {
      const result = await activityModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not find activities belonging to other users', async () => {
      const result = await activityModel.findById('find-activity-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesActivities).values([
        {
          id: 'update-activity',
          userId,
          type: 'event',
          narrative: 'Original Narrative',
          notes: 'Original Notes',
        },
        {
          id: 'other-user-activity',
          userId: otherUserId,
          type: 'event',
          narrative: 'Other Narrative',
        },
      ]);
    });

    it('should update activity', async () => {
      await activityModel.update('update-activity', {
        narrative: 'Updated Narrative',
        notes: 'Updated Notes',
      });

      const updated = await activityModel.findById('update-activity');
      expect(updated?.narrative).toBe('Updated Narrative');
      expect(updated?.notes).toBe('Updated Notes');
    });

    it('should update updatedAt timestamp', async () => {
      const before = await activityModel.findById('update-activity');
      const beforeUpdatedAt = before?.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await activityModel.update('update-activity', {
        narrative: 'Updated Narrative',
      });

      const after = await activityModel.findById('update-activity');
      expect(after?.updatedAt?.getTime()).toBeGreaterThan(beforeUpdatedAt?.getTime() || 0);
    });

    it('should not update activities belonging to other users', async () => {
      await activityModel.update('other-user-activity', {
        narrative: 'Hacked Narrative',
      });

      // Verify the other user's activity was not updated
      const result = await serverDB.query.userMemoriesActivities.findFirst({
        where: (a, { eq }) => eq(a.id, 'other-user-activity'),
      });
      expect(result?.narrative).toBe('Other Narrative');
    });
  });

  describe('delete', () => {
    it('should delete activity and associated user memory', async () => {
      // Create a user memory first
      const [memory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'activity-memory',
          userId,
          title: 'Activity Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      // Create activity with associated memory
      await serverDB.insert(userMemoriesActivities).values({
        id: 'delete-activity',
        userId,
        type: 'event',
        narrative: 'Activity to Delete',
        userMemoryId: memory.id,
      });

      const result = await activityModel.delete('delete-activity');

      expect(result.success).toBe(true);

      // Verify activity was deleted
      const deletedActivity = await activityModel.findById('delete-activity');
      expect(deletedActivity).toBeUndefined();

      // Verify associated memory was also deleted
      const deletedMemory = await serverDB.query.userMemories.findFirst({
        where: (m, { eq }) => eq(m.id, 'activity-memory'),
      });
      expect(deletedMemory).toBeUndefined();
    });

    it('should return success: false for non-existent activity', async () => {
      const result = await activityModel.delete('non-existent');

      expect(result.success).toBe(false);
    });

    it('should return success: false for activity without userMemoryId', async () => {
      await serverDB.insert(userMemoriesActivities).values({
        id: 'no-memory-activity',
        userId,
        type: 'event',
        narrative: 'No memory linked',
        userMemoryId: null,
      });

      const result = await activityModel.delete('no-memory-activity');

      expect(result.success).toBe(false);
    });

    it('should not delete activities belonging to other users', async () => {
      // Create memory for other user
      const [otherMemory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'other-activity-memory',
          userId: otherUserId,
          title: 'Other Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      await serverDB.insert(userMemoriesActivities).values({
        id: 'other-delete-activity',
        userId: otherUserId,
        type: 'event',
        narrative: 'Other Activity',
        userMemoryId: otherMemory.id,
      });

      const result = await activityModel.delete('other-delete-activity');

      expect(result.success).toBe(false);

      // Verify the activity still exists
      const stillExists = await serverDB.query.userMemoriesActivities.findFirst({
        where: (a, { eq }) => eq(a.id, 'other-delete-activity'),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesActivities).values([
        { id: 'user-activity-1', userId, type: 'event', narrative: 'User Activity 1' },
        { id: 'user-activity-2', userId, type: 'task', narrative: 'User Activity 2' },
        {
          id: 'other-activity',
          userId: otherUserId,
          type: 'event',
          narrative: 'Other Activity',
        },
      ]);
    });

    it('should delete all activities for current user only', async () => {
      await activityModel.deleteAll();

      // Verify user's activities were deleted
      const userActivities = await activityModel.query();
      expect(userActivities).toHaveLength(0);

      // Verify other user's activity still exists
      const otherActivity = await serverDB.query.userMemoriesActivities.findFirst({
        where: (a, { eq }) => eq(a.id, 'other-activity'),
      });
      expect(otherActivity).toBeDefined();
    });
  });
});
