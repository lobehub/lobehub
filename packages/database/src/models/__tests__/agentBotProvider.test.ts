// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentBotProviders, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentBotProviderModel } from '../agentBotProvider';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'bot-provider-test-user-id';
const userId2 = 'bot-provider-test-user-id-2';
const agentId = 'bot-provider-test-agent-id';
const agentId2 = 'bot-provider-test-agent-id-2';

const mockGateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
  encrypt: vi.fn(async (plaintext: string) => plaintext),
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: agentId2, userId: userId2 },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentBotProviders);
  await serverDB.delete(agents);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

describe('AgentBotProviderModel', () => {
  describe('create', () => {
    it('should create a bot provider without encryption', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);

      const result = await model.create({
        agentId,
        applicationId: 'app-123',
        credentials: { botToken: 'token-abc', publicKey: 'pk-xyz' },
        platform: 'discord',
      });

      expect(result.id).toBeDefined();
      expect(result.agentId).toBe(agentId);
      expect(result.platform).toBe('discord');
      expect(result.applicationId).toBe('app-123');
      expect(result.userId).toBe(userId);
      expect(result.enabled).toBe(true);
    });

    it('should create a bot provider with gateKeeper encryption', async () => {
      const model = new AgentBotProviderModel(serverDB, userId, mockGateKeeper);

      await model.create({
        agentId,
        applicationId: 'app-456',
        credentials: { botToken: 'token-def', signingSecret: 'secret-123' },
        platform: 'slack',
      });

      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ botToken: 'token-def', signingSecret: 'secret-123' }),
      );
    });
  });

  describe('delete', () => {
    it('should delete a bot provider owned by current user', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const created = await model.create({
        agentId,
        applicationId: 'app-del',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      await model.delete(created.id);

      const found = await model.findById(created.id);
      expect(found).toBeUndefined();
    });

    it('should not delete a bot provider owned by another user', async () => {
      const model1 = new AgentBotProviderModel(serverDB, userId);
      const model2 = new AgentBotProviderModel(serverDB, userId2);

      const created = await model1.create({
        agentId,
        applicationId: 'app-iso',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      await model2.delete(created.id);

      const found = await model1.findById(created.id);
      expect(found).toBeDefined();
    });
  });

  describe('query', () => {
    it('should return only providers for the current user', async () => {
      const model1 = new AgentBotProviderModel(serverDB, userId);
      const model2 = new AgentBotProviderModel(serverDB, userId2);

      await model1.create({
        agentId,
        applicationId: 'app-u1',
        credentials: { botToken: 't1' },
        platform: 'discord',
      });
      await model2.create({
        agentId: agentId2,
        applicationId: 'app-u2',
        credentials: { botToken: 't2' },
        platform: 'discord',
      });

      const results = await model1.query();
      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe(userId);
    });

    it('should filter by platform', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'app-d',
        credentials: { botToken: 't1' },
        platform: 'discord',
      });
      await model.create({
        agentId,
        applicationId: 'app-s',
        credentials: { botToken: 't2' },
        platform: 'slack',
      });

      const results = await model.query({ platform: 'slack' });
      expect(results).toHaveLength(1);
      expect(results[0].platform).toBe('slack');
    });

    it('should filter by agentId', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const otherAgentId = 'bot-provider-test-agent-other';
      await serverDB.insert(agents).values({ id: otherAgentId, userId });

      await model.create({
        agentId,
        applicationId: 'app-a1',
        credentials: { botToken: 't1' },
        platform: 'discord',
      });
      await model.create({
        agentId: otherAgentId,
        applicationId: 'app-a2',
        credentials: { botToken: 't2' },
        platform: 'discord',
      });

      const results = await model.query({ agentId });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe(agentId);
    });
  });

  describe('findById', () => {
    it('should return the provider with decrypted credentials', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const created = await model.create({
        agentId,
        applicationId: 'app-find',
        credentials: { botToken: 'secret-token', publicKey: 'pk' },
        platform: 'discord',
      });

      const found = await model.findById(created.id);
      expect(found).toBeDefined();
      expect(found!.credentials).toEqual({ botToken: 'secret-token', publicKey: 'pk' });
    });

    it('should return undefined for non-existent id', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const found = await model.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeUndefined();
    });

    it('should not return a provider owned by another user', async () => {
      const model1 = new AgentBotProviderModel(serverDB, userId);
      const model2 = new AgentBotProviderModel(serverDB, userId2);
      const created = await model1.create({
        agentId,
        applicationId: 'app-cross',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      const found = await model2.findById(created.id);
      expect(found).toBeUndefined();
    });
  });

  describe('findByAgentId', () => {
    it('should return all providers for an agent', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'app-d2',
        credentials: { botToken: 't1' },
        platform: 'discord',
      });
      await model.create({
        agentId,
        applicationId: 'app-s2',
        credentials: { botToken: 't2' },
        platform: 'slack',
      });

      const results = await model.findByAgentId(agentId);
      expect(results).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('should update non-credential fields', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const created = await model.create({
        agentId,
        applicationId: 'app-upd',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      await model.update(created.id, { enabled: false });

      const found = await model.findById(created.id);
      expect(found!.enabled).toBe(false);
    });

    it('should update credentials with re-encryption', async () => {
      const model = new AgentBotProviderModel(serverDB, userId, mockGateKeeper);
      const created = await model.create({
        agentId,
        applicationId: 'app-upd-cred',
        credentials: { botToken: 'old-token' },
        platform: 'slack',
      });

      await model.update(created.id, {
        credentials: { botToken: 'new-token', signingSecret: 'new-secret' },
      });

      const found = await model.findById(created.id);
      expect(found!.credentials).toEqual({ botToken: 'new-token', signingSecret: 'new-secret' });
    });

    it('should not update a provider owned by another user', async () => {
      const model1 = new AgentBotProviderModel(serverDB, userId);
      const model2 = new AgentBotProviderModel(serverDB, userId2);
      const created = await model1.create({
        agentId,
        applicationId: 'app-upd-iso',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      await model2.update(created.id, { enabled: false });

      const found = await model1.findById(created.id);
      expect(found!.enabled).toBe(true);
    });
  });

  describe('findEnabledByApplicationId', () => {
    it('should return enabled provider matching platform and appId', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'app-enabled',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      const result = await model.findEnabledByApplicationId('discord', 'app-enabled');
      expect(result).not.toBeNull();
      expect(result!.applicationId).toBe('app-enabled');
    });

    it('should return null for disabled provider', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const created = await model.create({
        agentId,
        applicationId: 'app-disabled',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });
      await model.update(created.id, { enabled: false });

      const result = await model.findEnabledByApplicationId('discord', 'app-disabled');
      expect(result).toBeNull();
    });
  });

  describe('findByPlatformAndAppId (static)', () => {
    it('should find provider across all users', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'global-app',
        credentials: { botToken: 'tok' },
        platform: 'slack',
      });

      const result = await AgentBotProviderModel.findByPlatformAndAppId(
        serverDB,
        'slack',
        'global-app',
      );
      expect(result).toBeDefined();
      expect(result!.platform).toBe('slack');
    });

    it('should return undefined for non-existent combination', async () => {
      const result = await AgentBotProviderModel.findByPlatformAndAppId(
        serverDB,
        'discord',
        'no-such-app',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('findEnabledByPlatform (static)', () => {
    it('should return Discord providers with botToken', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'discord-app',
        credentials: { botToken: 'discord-tok', publicKey: 'pk-abc' },
        platform: 'discord',
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(results).toHaveLength(1);
      expect(results[0].credentials.botToken).toBe('discord-tok');
      expect(results[0].credentials.publicKey).toBe('pk-abc');
    });

    it('should return Slack providers with botToken (no publicKey required)', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'slack-app',
        credentials: { botToken: 'slack-tok', signingSecret: 'ss-123' },
        platform: 'slack',
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'slack');
      expect(results).toHaveLength(1);
      expect(results[0].credentials.botToken).toBe('slack-tok');
      expect(results[0].credentials.signingSecret).toBe('ss-123');
    });

    it('should skip providers without botToken', async () => {
      await serverDB.insert(agentBotProviders).values({
        agentId,
        applicationId: 'no-token-app',
        credentials: JSON.stringify({ publicKey: 'pk-only' }),
        enabled: true,
        platform: 'discord',
        userId,
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(results).toHaveLength(0);
    });

    it('should skip providers with null credentials', async () => {
      await serverDB.insert(agentBotProviders).values({
        agentId,
        applicationId: 'null-cred-app',
        credentials: null,
        enabled: true,
        platform: 'discord',
        userId,
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(results).toHaveLength(0);
    });

    it('should skip disabled providers', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      const created = await model.create({
        agentId,
        applicationId: 'disabled-plat',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });
      await model.update(created.id, { enabled: false });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(results).toHaveLength(0);
    });

    it('should skip providers with invalid JSON credentials', async () => {
      await serverDB.insert(agentBotProviders).values({
        agentId,
        applicationId: 'bad-json-app',
        credentials: 'not-valid-json',
        enabled: true,
        platform: 'discord',
        userId,
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(results).toHaveLength(0);
    });

    it('should decrypt credentials with gateKeeper', async () => {
      const encrypted = JSON.stringify({ botToken: 'encrypted-tok' });
      const gateKeeper = {
        decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
        encrypt: vi.fn(),
      };

      await serverDB.insert(agentBotProviders).values({
        agentId,
        applicationId: 'gk-app',
        credentials: encrypted,
        enabled: true,
        platform: 'discord',
        userId,
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(
        serverDB,
        'discord',
        gateKeeper,
      );
      expect(gateKeeper.decrypt).toHaveBeenCalledWith(encrypted);
      expect(results).toHaveLength(1);
    });

    it('should return providers from multiple users', async () => {
      const model1 = new AgentBotProviderModel(serverDB, userId);
      const model2 = new AgentBotProviderModel(serverDB, userId2);

      await model1.create({
        agentId,
        applicationId: 'multi-app-1',
        credentials: { botToken: 't1' },
        platform: 'slack',
      });
      await model2.create({
        agentId: agentId2,
        applicationId: 'multi-app-2',
        credentials: { botToken: 't2' },
        platform: 'slack',
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'slack');
      expect(results).toHaveLength(2);
    });

    it('should not return providers from a different platform', async () => {
      const model = new AgentBotProviderModel(serverDB, userId);
      await model.create({
        agentId,
        applicationId: 'wrong-plat',
        credentials: { botToken: 'tok' },
        platform: 'discord',
      });

      const results = await AgentBotProviderModel.findEnabledByPlatform(serverDB, 'slack');
      expect(results).toHaveLength(0);
    });
  });

  describe('decryptRow edge cases', () => {
    it('should return empty credentials object when credentials is null', async () => {
      await serverDB.insert(agentBotProviders).values({
        agentId,
        applicationId: 'null-cred',
        credentials: null,
        enabled: true,
        platform: 'discord',
        userId,
      });

      const model = new AgentBotProviderModel(serverDB, userId);
      const results = await model.query();
      expect(results).toHaveLength(1);
      expect(results[0].credentials).toEqual({});
    });

    it('should return empty credentials on decryption failure', async () => {
      const failGateKeeper = {
        decrypt: vi.fn(async () => {
          throw new Error('decryption failed');
        }),
        encrypt: vi.fn(async (plaintext: string) => plaintext),
      };

      await serverDB.insert(agentBotProviders).values({
        agentId,
        applicationId: 'fail-decrypt',
        credentials: 'encrypted-blob',
        enabled: true,
        platform: 'discord',
        userId,
      });

      const model = new AgentBotProviderModel(serverDB, userId, failGateKeeper);
      const results = await model.query();
      expect(results).toHaveLength(1);
      expect(results[0].credentials).toEqual({});
    });
  });
});
