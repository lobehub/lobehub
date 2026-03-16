// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashApiKey } from '@/utils/server/apiKeyHash';

import { getTestDB } from '../../core/getTestDB';
import { apiKeys, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ApiKeyModel } from '../apiKey';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'api-key-model-test-user-id';
const validKeyVaultsSecret = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';

let apiKeyModel: ApiKeyModel;
let originalKeyVaultsSecret: string | undefined;

beforeEach(async () => {
  originalKeyVaultsSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = validKeyVaultsSecret;
  apiKeyModel = new ApiKeyModel(serverDB, userId);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(apiKeys).where(eq(apiKeys.userId, userId));
  process.env.KEY_VAULTS_SECRET = originalKeyVaultsSecret;
});

describe('ApiKeyModel', () => {
  describe('create', () => {
    it('should create a new API key with default hash behavior', async () => {
      const params = {
        enabled: true,
        name: 'Test API Key',
      };

      const result = await apiKeyModel.create(params);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(params.name);
      expect(result.enabled).toBe(params.enabled);
      expect(result.key).toBeDefined();
      expect(result.key).not.toMatch(/^sk-lh-[\da-z]{16}$/);
      expect(result.userId).toBe(userId);

      const apiKey = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, result.id),
      });
      expect(apiKey).toMatchObject({ ...params, userId });
      expect(apiKey?.key).toContain(':');
      expect(apiKey?.keyHash).toMatch(/^[\da-f]{64}$/);
    });

    it('should create API key with expiration date', async () => {
      const expiresAt = new Date('2025-12-31');
      const params = {
        enabled: true,
        expiresAt,
        name: 'Expiring Key',
      };

      const result = await apiKeyModel.create(params);

      expect(result.expiresAt).toEqual(expiresAt);
    });
  });

  describe('delete', () => {
    it('should delete an API key by id', async () => {
      const { id } = await apiKeyModel.create({ name: 'Test Key', enabled: true });

      await apiKeyModel.delete(id);

      const apiKey = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      expect(apiKey).toBeUndefined();
    });

    it('should only delete API keys for the current user', async () => {
      const { id: key1 } = await apiKeyModel.create({ name: 'User 1 Key', enabled: true });

      const anotherApiKeyModel = new ApiKeyModel(serverDB, 'user2');
      const { id: key2 } = await anotherApiKeyModel.create({
        name: 'User 2 Key',
        enabled: true,
      });

      await apiKeyModel.delete(key2);

      const key2Still = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, key2),
      });
      expect(key2Still).toBeDefined();

      await apiKeyModel.delete(key1);

      const key1Deleted = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, key1),
      });
      expect(key1Deleted).toBeUndefined();
    });
  });

  describe('deleteAll', () => {
    it('should delete all API keys for the user', async () => {
      await apiKeyModel.create({ name: 'Test Key 1', enabled: true });
      await apiKeyModel.create({ name: 'Test Key 2', enabled: true });

      await apiKeyModel.deleteAll();

      const userKeys = await serverDB.query.apiKeys.findMany({
        where: eq(apiKeys.userId, userId),
      });
      expect(userKeys).toHaveLength(0);
    });

    it('should only delete API keys for the user, not others', async () => {
      await apiKeyModel.create({ name: 'Test Key 1', enabled: true });
      await apiKeyModel.create({ name: 'Test Key 2', enabled: true });

      const anotherApiKeyModel = new ApiKeyModel(serverDB, 'user2');
      await anotherApiKeyModel.create({ name: 'User 2 Key', enabled: true });

      await apiKeyModel.deleteAll();

      const userKeys = await serverDB.query.apiKeys.findMany({
        where: eq(apiKeys.userId, userId),
      });
      const total = await serverDB.query.apiKeys.findMany();
      expect(userKeys).toHaveLength(0);
      expect(total).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should query API keys for the user', async () => {
      await apiKeyModel.create({ name: 'Key 1', enabled: true });
      await apiKeyModel.create({ name: 'Key 2', enabled: true });

      const keys = await apiKeyModel.query();
      expect(keys).toHaveLength(2);
      expect(keys[0].key).toMatch(/^sk-lh-[\da-z]{16}$/);
    });

    it('should query API keys ordered by updatedAt desc', async () => {
      const key1 = await apiKeyModel.create({ name: 'Key 1', enabled: true });
      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      const key2 = await apiKeyModel.create({ name: 'Key 2', enabled: true });

      const keys = await apiKeyModel.query();
      expect(keys).toHaveLength(2);
      expect(keys[0].id).toBe(key2.id);
      expect(keys[1].id).toBe(key1.id);
    });

    it('should only query API keys for the current user', async () => {
      await apiKeyModel.create({ name: 'User 1 Key', enabled: true });

      const anotherApiKeyModel = new ApiKeyModel(serverDB, 'user2');
      await anotherApiKeyModel.create({ name: 'User 2 Key', enabled: true });

      const keys = await apiKeyModel.query();
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('User 1 Key');
    });

    it('should throw when API key decryption is not authentic', async () => {
      await apiKeyModel.create({ name: 'Key 1', enabled: true });

      process.env.KEY_VAULTS_SECRET = 'Q10pwdq00KXUu9R+c8A8p4PSlIRWi7KwgUophBtkHVk=';
      const anotherApiKeyModel = new ApiKeyModel(serverDB, userId);

      await expect(anotherApiKeyModel.query()).rejects.toThrow(
        'Failed to decrypt API key. Please check whether KEY_VAULTS_SECRET is correct.',
      );
    });
  });

  describe('findByKey', () => {
    it('should find API key by key value without custom hasher', async () => {
      // Use a valid hex format key since validateApiKeyFormat checks for hex pattern
      const validKey = 'sk-lh-abcdef0123456789';
      await serverDB.insert(apiKeys).values({
        enabled: true,
        key: validKey,
        keyHash: hashApiKey(validKey),
        name: 'Test Key',
        userId,
      });

      const found = await apiKeyModel.findByKey(validKey);

      expect(found).toBeDefined();
      expect(found?.key).toBe(validKey);
      expect(found?.name).toBe('Test Key');
    });

    it('should return null for invalid key format', async () => {
      const found = await apiKeyModel.findByKey('invalid-key-format');

      expect(found).toBeNull();
    });

    it('should return undefined for non-existent key', async () => {
      const found = await apiKeyModel.findByKey('sk-lh-0123456789abcdef');

      expect(found).toBeUndefined();
    });
  });

  describe('validateKey', () => {
    it('should validate enabled and non-expired key with valid hex format', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      // Use a valid hex format key
      const validKey = 'sk-lh-0123456789abcdef';
      await serverDB.insert(apiKeys).values({
        enabled: true,
        expiresAt: futureDate,
        key: validKey,
        keyHash: hashApiKey(validKey),
        name: 'Valid Key',
        userId,
      });

      const isValid = await apiKeyModel.validateKey(validKey);

      expect(isValid).toBe(true);
    });

    it('should validate enabled key without expiration with valid hex format', async () => {
      // Use a valid hex format key
      const validKey = 'sk-lh-fedcba9876543210';
      await serverDB.insert(apiKeys).values({
        enabled: true,
        key: validKey,
        keyHash: hashApiKey(validKey),
        name: 'Valid Key',
        userId,
      });

      const isValid = await apiKeyModel.validateKey(validKey);

      expect(isValid).toBe(true);
    });

    it('should reject non-existent key', async () => {
      const isValid = await apiKeyModel.validateKey('sk-lh-0123456789abcdef');

      expect(isValid).toBe(false);
    });

    it('should reject disabled key', async () => {
      const validKey = 'sk-lh-1111111111111111';
      await serverDB.insert(apiKeys).values({
        enabled: false,
        key: validKey,
        keyHash: hashApiKey(validKey),
        name: 'Disabled Key',
        userId,
      });

      const isValid = await apiKeyModel.validateKey(validKey);

      expect(isValid).toBe(false);
    });

    it('should reject expired key', async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);

      const validKey = 'sk-lh-2222222222222222';
      await serverDB.insert(apiKeys).values({
        enabled: true,
        expiresAt: pastDate,
        key: validKey,
        keyHash: hashApiKey(validKey),
        name: 'Expired Key',
        userId,
      });

      const isValid = await apiKeyModel.validateKey(validKey);

      expect(isValid).toBe(false);
    });

    it('should reject invalid key format', async () => {
      const isValid = await apiKeyModel.validateKey('invalid-format');

      expect(isValid).toBe(false);
    });
  });

  describe('update', () => {
    it('should update API key properties', async () => {
      const { id } = await apiKeyModel.create({ name: 'Test Key', enabled: true });

      await apiKeyModel.update(id, { name: 'Updated Key', enabled: false });

      const updated = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      expect(updated).toMatchObject({
        enabled: false,
        id,
        name: 'Updated Key',
        userId,
      });
    });

    it('should update expiration date', async () => {
      const { id } = await apiKeyModel.create({ name: 'Test Key', enabled: true });

      const newExpiresAt = new Date('2026-12-31');
      await apiKeyModel.update(id, { expiresAt: newExpiresAt });

      const updated = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      expect(updated?.expiresAt).toEqual(newExpiresAt);
    });

    it('should only update API keys for the current user', async () => {
      const { id: key1 } = await apiKeyModel.create({ name: 'User 1 Key', enabled: true });

      const anotherApiKeyModel = new ApiKeyModel(serverDB, 'user2');
      const { id: key2 } = await anotherApiKeyModel.create({
        name: 'User 2 Key',
        enabled: true,
      });

      await apiKeyModel.update(key2, { name: 'Attempted Update' });

      const key2Still = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, key2),
      });
      expect(key2Still?.name).toBe('User 2 Key');
    });
  });

  describe('findById', () => {
    it('should find API key by id', async () => {
      const { id } = await apiKeyModel.create({ name: 'Test Key', enabled: true });

      const found = await apiKeyModel.findById(id);

      expect(found).toMatchObject({
        enabled: true,
        id,
        name: 'Test Key',
        userId,
      });
    });

    it('should return undefined for non-existent id', async () => {
      const found = await apiKeyModel.findById('999_999');

      expect(found).toBeUndefined();
    });

    it('should only find API keys for the current user', async () => {
      const anotherApiKeyModel = new ApiKeyModel(serverDB, 'user2');
      const { id: key2 } = await anotherApiKeyModel.create({
        name: 'User 2 Key',
        enabled: true,
      });

      const found = await apiKeyModel.findById(key2);

      expect(found).toBeUndefined();
    });
  });

  describe('updateLastUsed', () => {
    it('should update lastUsedAt timestamp', async () => {
      const { id } = await apiKeyModel.create({ name: 'Test Key', enabled: true });

      const beforeUpdate = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      expect(beforeUpdate?.lastUsedAt).toBeNull();

      await apiKeyModel.updateLastUsed(id);

      const afterUpdate = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      expect(afterUpdate?.lastUsedAt).toBeInstanceOf(Date);
    });

    it('should only update API keys for the current user', async () => {
      const anotherApiKeyModel = new ApiKeyModel(serverDB, 'user2');
      const { id: key2 } = await anotherApiKeyModel.create({
        name: 'User 2 Key',
        enabled: true,
      });

      await apiKeyModel.updateLastUsed(key2);

      const key2Still = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, key2),
      });
      expect(key2Still?.lastUsedAt).toBeNull();
    });

    it('should update existing lastUsedAt to a new timestamp', async () => {
      const { id } = await apiKeyModel.create({ name: 'Test Key', enabled: true });

      await apiKeyModel.updateLastUsed(id);

      const firstUpdate = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      const firstTimestamp = firstUpdate?.lastUsedAt;

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await apiKeyModel.updateLastUsed(id);

      const secondUpdate = await serverDB.query.apiKeys.findFirst({
        where: eq(apiKeys.id, id),
      });
      const secondTimestamp = secondUpdate?.lastUsedAt;

      expect(secondTimestamp).toBeDefined();
      expect(firstTimestamp).toBeDefined();
      expect(secondTimestamp!.getTime()).toBeGreaterThan(firstTimestamp!.getTime());
    });
  });
});
