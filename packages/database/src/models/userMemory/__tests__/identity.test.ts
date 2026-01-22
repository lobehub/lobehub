// @vitest-environment node
import { RelationshipEnum } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  NewUserMemoryIdentity,
  userMemories,
  userMemoriesIdentities,
  users,
} from '../../../schemas';
import { LobeChatDatabase } from '../../../type';
import { UserMemoryIdentityModel } from '../identity';

const userId = 'identity-test-user';
const otherUserId = 'other-identity-user';

let identityModel: UserMemoryIdentityModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize model
  identityModel = new UserMemoryIdentityModel(serverDB, userId);
});

describe('UserMemoryIdentityModel', () => {
  describe('create', () => {
    it('should create a new identity', async () => {
      const identityData: Omit<NewUserMemoryIdentity, 'userId'> = {
        type: 'personal',
        description: 'Software developer',
        role: 'developer',
        relationship: RelationshipEnum.Self,
      };

      const result = await identityModel.create(identityData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.type).toBe('personal');
      expect(result.description).toBe('Software developer');
      expect(result.role).toBe('developer');
      expect(result.relationship).toBe(RelationshipEnum.Self);
    });

    it('should auto-assign userId from model', async () => {
      const result = await identityModel.create({
        type: 'professional',
        description: 'Test identity',
      });

      expect(result.userId).toBe(userId);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test identities
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: 'identity-1',
          userId,
          type: 'personal',
          description: 'Identity 1',
          capturedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'identity-2',
          userId,
          type: 'professional',
          description: 'Identity 2',
          capturedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'other-identity',
          userId: otherUserId,
          type: 'personal',
          description: 'Other Identity',
          capturedAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
    });

    it('should return identities for current user only', async () => {
      const result = await identityModel.query();

      expect(result).toHaveLength(2);
      expect(result.every((i) => i.userId === userId)).toBe(true);
    });

    it('should order by capturedAt desc', async () => {
      const result = await identityModel.query();

      expect(result[0].id).toBe('identity-2'); // Most recent first
      expect(result[1].id).toBe('identity-1');
    });

    it('should respect limit parameter', async () => {
      const result = await identityModel.query(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('identity-2');
    });

    it('should not return other users identities', async () => {
      const result = await identityModel.query();

      const otherIdentity = result.find((i) => i.id === 'other-identity');
      expect(otherIdentity).toBeUndefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: 'find-identity-1',
          userId,
          type: 'personal',
          description: 'Find Identity 1',
        },
        {
          id: 'find-identity-other',
          userId: otherUserId,
          type: 'personal',
          description: 'Other Identity',
        },
      ]);
    });

    it('should find identity by ID for current user', async () => {
      const result = await identityModel.findById('find-identity-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('find-identity-1');
      expect(result?.description).toBe('Find Identity 1');
    });

    it('should return undefined for non-existent identity', async () => {
      const result = await identityModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not find identities belonging to other users', async () => {
      const result = await identityModel.findById('find-identity-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: 'update-identity',
          userId,
          type: 'personal',
          description: 'Original Description',
          role: 'original-role',
        },
        {
          id: 'other-user-identity',
          userId: otherUserId,
          type: 'personal',
          description: 'Other Description',
        },
      ]);
    });

    it('should update identity', async () => {
      await identityModel.update('update-identity', {
        description: 'Updated Description',
        role: 'updated-role',
      });

      const updated = await identityModel.findById('update-identity');
      expect(updated?.description).toBe('Updated Description');
      expect(updated?.role).toBe('updated-role');
    });

    it('should not update identities belonging to other users', async () => {
      await identityModel.update('other-user-identity', {
        description: 'Hacked Description',
      });

      // Verify the other user's identity was not updated
      const result = await serverDB.query.userMemoriesIdentities.findFirst({
        where: (i, { eq }) => eq(i.id, 'other-user-identity'),
      });
      expect(result?.description).toBe('Other Description');
    });
  });

  describe('delete', () => {
    it('should delete identity and associated user memory', async () => {
      // Create a user memory first
      const [memory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'identity-memory',
          userId,
          title: 'Identity Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      // Create identity with associated memory
      await serverDB.insert(userMemoriesIdentities).values({
        id: 'delete-identity',
        userId,
        type: 'personal',
        description: 'Identity to Delete',
        userMemoryId: memory.id,
      });

      const result = await identityModel.delete('delete-identity');

      expect(result.success).toBe(true);

      // Verify identity was deleted
      const deletedIdentity = await identityModel.findById('delete-identity');
      expect(deletedIdentity).toBeUndefined();

      // Verify associated memory was also deleted
      const deletedMemory = await serverDB.query.userMemories.findFirst({
        where: (m, { eq }) => eq(m.id, 'identity-memory'),
      });
      expect(deletedMemory).toBeUndefined();
    });

    it('should return success: false for non-existent identity', async () => {
      const result = await identityModel.delete('non-existent');

      expect(result.success).toBe(false);
    });

    it('should return success: false for identity without userMemoryId', async () => {
      await serverDB.insert(userMemoriesIdentities).values({
        id: 'no-memory-identity',
        userId,
        type: 'personal',
        description: 'No memory linked',
        userMemoryId: null,
      });

      const result = await identityModel.delete('no-memory-identity');

      expect(result.success).toBe(false);
    });

    it('should not delete identities belonging to other users', async () => {
      // Create memory for other user
      const [otherMemory] = await serverDB
        .insert(userMemories)
        .values({
          id: 'other-identity-memory',
          userId: otherUserId,
          title: 'Other Memory',
          lastAccessedAt: new Date(),
        })
        .returning();

      await serverDB.insert(userMemoriesIdentities).values({
        id: 'other-delete-identity',
        userId: otherUserId,
        type: 'personal',
        description: 'Other Identity',
        userMemoryId: otherMemory.id,
      });

      const result = await identityModel.delete('other-delete-identity');

      expect(result.success).toBe(false);

      // Verify the identity still exists
      const stillExists = await serverDB.query.userMemoriesIdentities.findFirst({
        where: (i, { eq }) => eq(i.id, 'other-delete-identity'),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    beforeEach(async () => {
      await serverDB.insert(userMemoriesIdentities).values([
        { id: 'user-identity-1', userId, type: 'personal', description: 'User Identity 1' },
        { id: 'user-identity-2', userId, type: 'professional', description: 'User Identity 2' },
        {
          id: 'other-identity',
          userId: otherUserId,
          type: 'personal',
          description: 'Other Identity',
        },
      ]);
    });

    it('should delete all identities for current user only', async () => {
      await identityModel.deleteAll();

      // Verify user's identities were deleted
      const userIdentities = await identityModel.query();
      expect(userIdentities).toHaveLength(0);

      // Verify other user's identity still exists
      const otherIdentity = await serverDB.query.userMemoriesIdentities.findFirst({
        where: (i, { eq }) => eq(i.id, 'other-identity'),
      });
      expect(otherIdentity).toBeDefined();
    });
  });

  describe('queryForInjection', () => {
    beforeEach(async () => {
      // Create identities with different relationships
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: 'self-identity',
          userId,
          type: 'personal',
          description: 'Self Identity',
          role: 'developer',
          relationship: RelationshipEnum.Self,
          capturedAt: new Date('2024-01-03T10:00:00Z'),
        },
        {
          id: 'null-relationship-identity',
          userId,
          type: 'personal',
          description: 'Null Relationship Identity',
          role: 'engineer',
          relationship: null,
          capturedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'friend-identity',
          userId,
          type: 'personal',
          description: 'Friend Identity',
          role: 'friend',
          relationship: RelationshipEnum.Friend,
          capturedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'other-user-self',
          userId: otherUserId,
          type: 'personal',
          description: 'Other User Self',
          relationship: RelationshipEnum.Self,
          capturedAt: new Date('2024-01-04T10:00:00Z'),
        },
      ]);
    });

    it('should only return self and null relationship identities', async () => {
      const result = await identityModel.queryForInjection();

      expect(result).toHaveLength(2);

      const ids = result.map((i) => i.id);
      expect(ids).toContain('self-identity');
      expect(ids).toContain('null-relationship-identity');
      expect(ids).not.toContain('friend-identity');
    });

    it('should order by capturedAt desc', async () => {
      const result = await identityModel.queryForInjection();

      expect(result[0].id).toBe('self-identity'); // Most recent capturedAt
      expect(result[1].id).toBe('null-relationship-identity');
    });

    it('should respect limit parameter', async () => {
      const result = await identityModel.queryForInjection(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('self-identity');
    });

    it('should not return other users identities', async () => {
      const result = await identityModel.queryForInjection();

      const otherUserIdentity = result.find((i) => i.id === 'other-user-self');
      expect(otherUserIdentity).toBeUndefined();
    });

    it('should return correct fields for injection', async () => {
      const result = await identityModel.queryForInjection();

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('type');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('role');
      expect(result[0]).toHaveProperty('capturedAt');
      expect(result[0]).toHaveProperty('createdAt');
      expect(result[0]).toHaveProperty('updatedAt');
    });
  });
});
