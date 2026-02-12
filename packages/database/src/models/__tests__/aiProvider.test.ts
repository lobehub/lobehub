// @vitest-environment node
import { eq } from 'drizzle-orm';
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sleep } from '@/utils/sleep';

import { getTestDB } from '../../core/getTestDB';
import { aiProviders, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiProviderModel } from '../aiProvider';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-group-model-test-user-id';
const aiProviderModel = new AiProviderModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(aiProviders).where(eq(aiProviders.userId, userId));
});

describe('AiProviderModel', () => {
  describe('create', () => {
    it('should create a new ai provider', async () => {
      const params = {
        name: 'AiHubMix',
        id: 'aihubmix',
        source: 'custom',
      } as const;

      const result = await aiProviderModel.create(params);
      expect(result.id).toBeDefined();
      expect(result).toMatchObject({ ...params, userId });

      const group = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, result.id),
      });
      expect(group).toMatchObject({ ...params, userId });
    });
  });
  describe('delete', () => {
    it('should delete a ai provider by id', async () => {
      const { id } = await aiProviderModel.create({
        name: 'AiHubMix',
        id: 'aihubmix',
        source: 'custom',
      });

      await aiProviderModel.delete(id);

      const group = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, id),
      });
      expect(group).toBeUndefined();
    });
  });
  describe('deleteAll', () => {
    it('should delete all ai providers for the user', async () => {
      await aiProviderModel.create({ name: 'AiHubMix', source: 'custom', id: 'aihubmix' });
      await aiProviderModel.create({ name: 'AiHubMix', source: 'custom', id: 'aihubmix-2' });

      await aiProviderModel.deleteAll();

      const userGroups = await serverDB.query.aiProviders.findMany({
        where: eq(aiProviders.userId, userId),
      });
      expect(userGroups).toHaveLength(0);
    });
    it('should only delete ai providers for the user, not others', async () => {
      await aiProviderModel.create({ name: 'AiHubMix', source: 'custom', id: 'aihubmix' });
      await aiProviderModel.create({ name: 'AiHubMix', source: 'custom', id: 'aihubmix-2' });

      const anotherAiProviderModel = new AiProviderModel(serverDB, 'user2');
      await anotherAiProviderModel.create({
        id: 'aihubmix',
        source: 'custom',
        name: 'Another provider',
      });

      await aiProviderModel.deleteAll();

      const userGroups = await serverDB.query.aiProviders.findMany({
        where: eq(aiProviders.userId, userId),
      });
      const total = await serverDB.query.aiProviders.findMany();
      expect(userGroups).toHaveLength(0);
      expect(total).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should query ai providers for the user', async () => {
      await aiProviderModel.create({ name: 'AiHubMix', source: 'custom', id: 'aihubmix' });
      await sleep(10);
      await aiProviderModel.create({ name: 'AiHubMix', source: 'custom', id: 'aihubmix-2' });

      const userGroups = await aiProviderModel.query();
      expect(userGroups).toHaveLength(2);
      expect(userGroups[0].id).toBe('aihubmix-2');
      expect(userGroups[1].id).toBe('aihubmix');
    });
  });

  describe('findById', () => {
    it('should find a ai provider by id', async () => {
      const { id } = await aiProviderModel.create({
        name: 'AiHubMix',
        source: 'custom',
        id: 'aihubmix',
      });

      const group = await aiProviderModel.findById(id);
      expect(group).toMatchObject({
        id,
        name: 'AiHubMix',
        userId,
      });
    });
  });

  describe('update', () => {
    it('should update a ai provider', async () => {
      const { id } = await aiProviderModel.create({
        name: 'AiHubMix',
        source: 'custom',
        id: 'aihubmix',
      });

      await aiProviderModel.update(id, { name: 'Updated Test Group', sort: 3 });

      const updatedGroup = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, id),
      });
      expect(updatedGroup).toMatchObject({
        id,
        name: 'Updated Test Group',
        sort: 3,
        userId,
      });
    });
  });

  describe('updateOrder', () => {
    it('should update order of ai providers', async () => {
      const group1 = await aiProviderModel.create({
        name: 'AiHubMix',
        source: 'custom',
        id: 'aihubmix',
      });
      const group2 = await aiProviderModel.create({
        name: 'AiHubMix',
        source: 'custom',
        id: 'aihubmix-2',
      });

      await aiProviderModel.updateOrder([
        { id: group1.id, sort: 3 },
        { id: group2.id, sort: 4 },
      ]);

      const updatedGroup1 = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, group1.id),
      });
      const updatedGroup2 = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, group2.id),
      });

      expect(updatedGroup1?.sort).toBe(3);
      expect(updatedGroup2?.sort).toBe(4);
    });
  });

  describe('getAiProviderList', () => {
    it('should return a list of ai providers with selected fields', async () => {
      await serverDB.insert(aiProviders).values({
        description: 'Test description',
        enabled: true,
        id: 'aihubmix',
        logo: 'test-logo',
        name: 'AiHubMix',
        sort: 1,
        source: 'custom',
        userId,
      });

      const list = await aiProviderModel.getAiProviderList();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        description: 'Test description',
        enabled: true,
        id: 'aihubmix',
        logo: 'test-logo',
        name: 'AiHubMix',
        sort: 1,
        source: 'custom',
      });
    });
  });

  describe('updateConfig', () => {
    it('should update provider config with encryption and merge keyVaults', async () => {
      const providerId = 'aihubmix';
      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: JSON.stringify({ key: 'value' }),
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      const mockEncryptor = vi.fn().mockResolvedValue('encrypted-data');
      await aiProviderModel.updateConfig(
        providerId,
        {
          keyVaults: { newKey: 'newValue' },
          fetchOnClient: true,
        },
        mockEncryptor,
      );

      const updated = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, providerId),
      });

      // Should merge existing keyVaults with new values
      expect(mockEncryptor).toHaveBeenCalledWith(
        JSON.stringify({ key: 'value', newKey: 'newValue' }),
      );
      expect(updated?.keyVaults).toBe('encrypted-data');
      expect(updated?.fetchOnClient).toBeTruthy();
    });

    it('should update provider config without encryption', async () => {
      const providerId = 'aihubmix';
      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: JSON.stringify({ key: 'value' }),
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      await aiProviderModel.updateConfig(providerId, {
        keyVaults: { newKey: 'newValue' },
      });

      const updated = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, providerId),
      });

      expect(updated?.keyVaults).toBe(JSON.stringify({ key: 'value', newKey: 'newValue' }));
    });

    it('should merge keyVaults with existing values when decryptor is provided', async () => {
      const providerId = 'aihubmix';
      const existingKeyVaults = {
        apiKey: 'existing-api-key',
        oauthAccessToken: 'existing-oauth-token',
        bearerToken: 'existing-bearer-token',
      };

      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: JSON.stringify(existingKeyVaults),
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      const mockEncryptor = vi.fn().mockImplementation((s: string) => Promise.resolve(s));
      const mockDecryptor = vi
        .fn()
        .mockImplementation((s: string) => Promise.resolve(JSON.parse(s)));

      // Update only apiKey, should preserve oauthAccessToken and bearerToken
      await aiProviderModel.updateConfig(
        providerId,
        {
          keyVaults: { apiKey: 'new-api-key' },
        },
        mockEncryptor,
        mockDecryptor,
      );

      const updated = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, providerId),
      });

      const updatedKeyVaults = JSON.parse(updated?.keyVaults || '{}');
      expect(updatedKeyVaults).toEqual({
        apiKey: 'new-api-key',
        bearerToken: 'existing-bearer-token',
        oauthAccessToken: 'existing-oauth-token',
      });
    });

    it('should preserve OAuth tokens when updating non-OAuth fields', async () => {
      const providerId = 'aihubmix';
      const existingKeyVaults = {
        bearerToken: 'copilot-bearer-token',
        bearerTokenExpiresAt: '1700000000000',
        oauthAccessToken: 'ghu_oauth_token',
      };

      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: JSON.stringify(existingKeyVaults),
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      const mockEncryptor = vi.fn().mockImplementation((s: string) => Promise.resolve(s));
      const mockDecryptor = vi
        .fn()
        .mockImplementation((s: string) => Promise.resolve(JSON.parse(s)));

      // Update with empty keyVaults (simulating form submit without OAuth fields)
      await aiProviderModel.updateConfig(
        providerId,
        {
          keyVaults: {},
          fetchOnClient: true,
        },
        mockEncryptor,
        mockDecryptor,
      );

      const updated = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, providerId),
      });

      const updatedKeyVaults = JSON.parse(updated?.keyVaults || '{}');
      expect(updatedKeyVaults).toEqual(existingKeyVaults);
      expect(updated?.fetchOnClient).toBe(true);
    });

    it('should handle decryption errors gracefully and use new values only', async () => {
      const providerId = 'aihubmix';

      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: 'invalid-encrypted-data',
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      const mockEncryptor = vi.fn().mockImplementation((s: string) => Promise.resolve(s));
      const mockDecryptor = vi.fn().mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await aiProviderModel.updateConfig(
        providerId,
        {
          keyVaults: { newKey: 'newValue' },
        },
        mockEncryptor,
        mockDecryptor,
      );

      const updated = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, providerId),
      });

      expect(updated?.keyVaults).toBe(JSON.stringify({ newKey: 'newValue' }));
    });

    it('should allow clearing OAuth tokens explicitly', async () => {
      const providerId = 'aihubmix';
      const existingKeyVaults = {
        apiKey: 'api-key',
        bearerToken: 'bearer-token',
        oauthAccessToken: 'oauth-token',
      };

      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: JSON.stringify(existingKeyVaults),
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      const mockEncryptor = vi.fn().mockImplementation((s: string) => Promise.resolve(s));
      const mockDecryptor = vi
        .fn()
        .mockImplementation((s: string) => Promise.resolve(JSON.parse(s)));

      // Explicitly set OAuth tokens to undefined to clear them
      await aiProviderModel.updateConfig(
        providerId,
        {
          keyVaults: {
            apiKey: 'api-key',
            bearerToken: undefined,
            oauthAccessToken: undefined,
          },
        },
        mockEncryptor,
        mockDecryptor,
      );

      const updated = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, providerId),
      });

      const updatedKeyVaults = JSON.parse(updated?.keyVaults || '{}');
      expect(updatedKeyVaults.apiKey).toBe('api-key');
      expect(updatedKeyVaults.bearerToken).toBeUndefined();
      expect(updatedKeyVaults.oauthAccessToken).toBeUndefined();
    });
  });

  describe('toggleProviderEnabled', () => {
    it('should toggle builtin provider enabled status', async () => {
      const builtinId = ModelProvider.OpenAI;
      await aiProviderModel.toggleProviderEnabled(builtinId, true);

      const provider = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, builtinId),
      });

      expect(provider?.enabled).toBe(true);
      expect(provider?.source).toBe('builtin');
    });

    it('should toggle custom provider enabled status', async () => {
      const customId = 'custom-provider';
      await aiProviderModel.toggleProviderEnabled(customId, false);

      const provider = await serverDB.query.aiProviders.findFirst({
        where: eq(aiProviders.id, customId),
      });

      expect(provider?.enabled).toBe(false);
      expect(provider?.source).toBe('custom');
    });
  });

  describe('getAiProviderById', () => {
    it('should get provider details with decryption', async () => {
      const providerId = 'aihubmix';
      const mockDecryptor = vi.fn().mockResolvedValue({ decryptedKey: 'value' });

      await serverDB.insert(aiProviders).values({
        id: providerId,
        keyVaults: JSON.stringify({ key: 'value' }),
        name: 'AiHubMix',
        settings: { setting1: true } as any,
        source: 'custom',
        userId,
      });

      const provider = await aiProviderModel.getAiProviderById(providerId, mockDecryptor);

      expect(provider).toBeDefined();
      expect(provider?.keyVaults).toEqual({ decryptedKey: 'value' });
    });

    it('should handle non-existent provider for builtin provider', async () => {
      const builtinId = ModelProvider.OpenAI;
      const provider = await aiProviderModel.getAiProviderById(builtinId, (text) =>
        JSON.parse(text as string),
      );

      expect(provider).toBeDefined();
      expect(provider?.source).toBe('builtin');
    });

    it('should return undefined for non-existent custom provider', async () => {
      const provider = await aiProviderModel.getAiProviderById('non-existent', (text) =>
        JSON.parse(text as string),
      );

      expect(provider).toBeUndefined();
    });

    it('should handle null keyVaults', async () => {
      const providerId = 'aihubmix';
      await serverDB.insert(aiProviders).values({
        id: providerId,
        name: 'AiHubMix',
        source: 'custom',
        userId,
      });

      const provider = await aiProviderModel.getAiProviderById(providerId, (text) =>
        JSON.parse(text as string),
      );

      expect(provider?.keyVaults).toEqual({});
    });
  });

  describe('getAiProviderRuntimeConfig', () => {
    it('should get runtime config for all providers', async () => {
      const mockDecryptor = vi.fn().mockResolvedValue({ decryptedKey: 'value' });

      await serverDB.insert(aiProviders).values([
        {
          fetchOnClient: true,
          id: 'provider1',
          keyVaults: JSON.stringify({ key: 'value' }),
          name: 'Provider 1',
          settings: { setting1: true } as any,
          source: 'custom',
          userId,
        },
        {
          id: 'provider2',
          name: 'Provider 2',
          source: 'custom',
          userId,
        },
      ]);

      const config = await aiProviderModel.getAiProviderRuntimeConfig(mockDecryptor);

      expect(config.provider1).toEqual({
        config: {},
        fetchOnClient: true,
        keyVaults: { decryptedKey: 'value' },
        settings: { setting1: true },
      });

      expect(config.provider2).toEqual({
        config: {},
        fetchOnClient: undefined,
        keyVaults: {},
        settings: {},
      });
    });

    it('should handle decrypt error gracefully', async () => {
      const failingDecryptor = vi.fn().mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await serverDB.insert(aiProviders).values({
        id: 'provider-with-bad-keys',
        keyVaults: 'invalid-encrypted-data',
        name: 'Bad Provider',
        source: 'custom',
        userId,
      });

      const config = await aiProviderModel.getAiProviderRuntimeConfig(failingDecryptor);

      expect(config['provider-with-bad-keys'].keyVaults).toEqual({});
      expect(failingDecryptor).toHaveBeenCalled();
    });

    it('should handle null keyVaults gracefully', async () => {
      await serverDB.insert(aiProviders).values({
        id: 'provider-no-keys',
        keyVaults: null,
        name: 'No Keys Provider',
        source: 'custom',
        userId,
      });

      const config = await aiProviderModel.getAiProviderRuntimeConfig();

      expect(config['provider-no-keys'].keyVaults).toEqual({});
    });

    it('should respect fetchOnClient property', async () => {
      await serverDB.insert(aiProviders).values([
        {
          fetchOnClient: true,
          id: 'client-provider',
          name: 'Client Provider',
          source: 'custom',
          userId,
        },
        {
          fetchOnClient: false,
          id: 'server-provider',
          name: 'Server Provider',
          source: 'custom',
          userId,
        },
        {
          id: 'undefined-provider',
          name: 'Undefined Provider',
          source: 'custom',
          userId,
        },
      ]);

      const config = await aiProviderModel.getAiProviderRuntimeConfig();

      expect(config['client-provider'].fetchOnClient).toBe(true);
      expect(config['server-provider'].fetchOnClient).toBe(false);
      expect(config['undefined-provider'].fetchOnClient).toBeUndefined();
    });

    it('should use empty object as default for settings', async () => {
      await serverDB.insert(aiProviders).values({
        id: 'no-settings-provider',
        name: 'No Settings Provider',
        settings: null as any,
        source: 'custom',
        userId,
      });

      const config = await aiProviderModel.getAiProviderRuntimeConfig();

      expect(config['no-settings-provider'].settings).toEqual({});
    });

    it('should only include providers for the current user', async () => {
      await serverDB.insert(aiProviders).values([
        {
          id: 'user1-provider',
          name: 'User 1 Provider',
          source: 'custom',
          userId,
        },
        {
          id: 'user2-provider',
          name: 'User 2 Provider',
          source: 'custom',
          userId: 'user2',
        },
      ]);

      const config = await aiProviderModel.getAiProviderRuntimeConfig();

      expect(config['user1-provider']).toBeDefined();
      expect(config['user2-provider']).toBeUndefined();
    });
  });
});
