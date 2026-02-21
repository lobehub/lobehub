// @vitest-environment node
import { RelationshipEnum } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { idGenerator } from '@/database/utils/idGenerator';

import { getTestDB } from '../../core/getTestDB';
import { userMemoriesIdentities, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserMemoryIdentityModel } from '../userMemory/identity';

// Helper to generate unique identity IDs
const genIdentityId = () => `mem_${nanoid(12)}`;

const serverDB: LobeChatDatabase = await getTestDB();

const userId = idGenerator('user');
const userId2 = idGenerator('user');

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, userId2));
});

describe('UserMemoryIdentityModel', () => {
  describe('queryForInjection', () => {
    it('should return only self identities (relationship === self)', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      // Create identities with different relationships
      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: genIdentityId(),
          userId,
          description: 'I am a software engineer',
          relationship: RelationshipEnum.Self,
          role: 'Software Engineer',
          type: 'professional',
          capturedAt: new Date(now.getTime() - 1000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'My father is a teacher',
          relationship: RelationshipEnum.Father,
          role: 'Teacher',
          type: 'personal',
          capturedAt: new Date(now.getTime() - 2000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'I live in Shanghai',
          relationship: RelationshipEnum.Self,
          role: null,
          type: 'demographic',
          capturedAt: new Date(now.getTime() - 3000),
        },
      ]);

      const result = await model.queryForInjection();

      // Should only return self identities
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.description?.includes('I '))).toBe(true);
      expect(result.some((r) => r.description?.includes('father'))).toBe(false);
    });

    it('should return identities with null relationship (treated as self)', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: genIdentityId(),
          userId,
          description: 'Identity with null relationship',
          relationship: null,
          role: 'Developer',
          type: 'professional',
          capturedAt: new Date(now.getTime() - 1000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Identity with self relationship',
          relationship: RelationshipEnum.Self,
          role: 'Designer',
          type: 'professional',
          capturedAt: new Date(now.getTime() - 2000),
        },
      ]);

      const result = await model.queryForInjection();

      // Should return both null and self relationships
      expect(result).toHaveLength(2);
    });

    it('should exclude non-self relationships (friend, colleague, etc.)', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: genIdentityId(),
          userId,
          description: 'My friend likes coding',
          relationship: RelationshipEnum.Friend,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 1000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'My colleague works on AI',
          relationship: RelationshipEnum.Colleague,
          type: 'professional',
          capturedAt: new Date(now.getTime() - 2000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'My mother is a doctor',
          relationship: RelationshipEnum.Mother,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 3000),
        },
      ]);

      const result = await model.queryForInjection();

      // Should return empty since none are self
      expect(result).toHaveLength(0);
    });

    it('should respect the limit parameter', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      // Create 5 self identities
      const now = new Date();
      const identities = Array.from({ length: 5 }, (_, i) => ({
        id: genIdentityId(),
        userId,
        description: `Self identity ${i + 1}`,
        relationship: RelationshipEnum.Self,
        type: 'personal',
        capturedAt: new Date(now.getTime() - i * 1000),
      }));

      await serverDB.insert(userMemoriesIdentities).values(identities);

      const result = await model.queryForInjection(3);

      expect(result).toHaveLength(3);
    });

    it('should order by capturedAt descending (most recent first)', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: genIdentityId(),
          userId,
          description: 'Oldest identity',
          relationship: RelationshipEnum.Self,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 3000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Newest identity',
          relationship: RelationshipEnum.Self,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 1000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Middle identity',
          relationship: RelationshipEnum.Self,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 2000),
        },
      ]);

      const result = await model.queryForInjection();

      expect(result).toHaveLength(3);
      expect(result[0].description).toBe('Newest identity');
      expect(result[1].description).toBe('Middle identity');
      expect(result[2].description).toBe('Oldest identity');
    });

    it('should only return identities for the current user', async () => {
      const model1 = new UserMemoryIdentityModel(serverDB, userId);
      const model2 = new UserMemoryIdentityModel(serverDB, userId2);

      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: genIdentityId(),
          userId,
          description: 'User 1 identity',
          relationship: RelationshipEnum.Self,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 1000),
        },
        {
          id: genIdentityId(),
          userId: userId2,
          description: 'User 2 identity',
          relationship: RelationshipEnum.Self,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 2000),
        },
      ]);

      const result1 = await model1.queryForInjection();
      const result2 = await model2.queryForInjection();

      expect(result1).toHaveLength(1);
      expect(result1[0].description).toBe('User 1 identity');

      expect(result2).toHaveLength(1);
      expect(result2[0].description).toBe('User 2 identity');
    });

    it('should return correct fields for injection', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values({
        id: genIdentityId(),
        userId,
        description: 'Test description',
        relationship: RelationshipEnum.Self,
        role: 'Test Role',
        type: 'professional',
        capturedAt: now,
      });

      const result = await model.queryForInjection();

      expect(result).toHaveLength(1);
      const identity = result[0];

      // Check that required fields are present
      expect(identity).toHaveProperty('id');
      expect(identity).toHaveProperty('description');
      expect(identity).toHaveProperty('role');
      expect(identity).toHaveProperty('type');
      expect(identity).toHaveProperty('createdAt');
      expect(identity).toHaveProperty('updatedAt');
      expect(identity).toHaveProperty('capturedAt');

      // Check values
      expect(identity.description).toBe('Test description');
      expect(identity.role).toBe('Test Role');
      expect(identity.type).toBe('professional');
    });

    it('should return empty array when no self identities exist', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      // No identities inserted
      const result = await model.queryForInjection();

      expect(result).toHaveLength(0);
    });

    it('should handle mixed relationships correctly', async () => {
      const model = new UserMemoryIdentityModel(serverDB, userId);

      const now = new Date();
      await serverDB.insert(userMemoriesIdentities).values([
        {
          id: genIdentityId(),
          userId,
          description: 'Self 1',
          relationship: RelationshipEnum.Self,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 1000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Friend',
          relationship: RelationshipEnum.Friend,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 2000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Null relationship',
          relationship: null,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 3000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Spouse',
          relationship: RelationshipEnum.Spouse,
          type: 'personal',
          capturedAt: new Date(now.getTime() - 4000),
        },
        {
          id: genIdentityId(),
          userId,
          description: 'Self 2',
          relationship: RelationshipEnum.Self,
          type: 'demographic',
          capturedAt: new Date(now.getTime() - 5000),
        },
      ]);

      const result = await model.queryForInjection();

      // Should only return Self 1, Null relationship, and Self 2
      expect(result).toHaveLength(3);
      const descriptions = result.map((r) => r.description);
      expect(descriptions).toContain('Self 1');
      expect(descriptions).toContain('Null relationship');
      expect(descriptions).toContain('Self 2');
      expect(descriptions).not.toContain('Friend');
      expect(descriptions).not.toContain('Spouse');
    });
  });
});
