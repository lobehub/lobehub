// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { systemBotProviders } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SystemBotProviderModel } from '../systemBotProvider';

const serverDB: LobeChatDatabase = await getTestDB();

const mockGateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
  encrypt: vi.fn(async (plaintext: string) => plaintext),
};

beforeEach(async () => {
  await serverDB.delete(systemBotProviders);
});

afterEach(async () => {
  await serverDB.delete(systemBotProviders);
  vi.clearAllMocks();
});

describe('SystemBotProviderModel', () => {
  describe('upsertByPlatform', () => {
    it('inserts a new row with encrypted credentials and round-trips them', async () => {
      const created = await SystemBotProviderModel.upsertByPlatform(
        serverDB,
        {
          applicationId: 'app-1',
          credentials: { botToken: 'bot-token-1', publicKey: 'pk-1' },
          platform: 'discord',
          settings: { connectionMode: 'webhook' },
        },
        mockGateKeeper,
      );

      expect(created.id).toBeDefined();
      expect(created.platform).toBe('discord');
      expect(created.enabled).toBe(true);
      expect(created.applicationId).toBe('app-1');
      expect(created.settings).toEqual({ connectionMode: 'webhook' });
      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ botToken: 'bot-token-1', publicKey: 'pk-1' }),
      );

      const found = await SystemBotProviderModel.findById(serverDB, created.id, mockGateKeeper);
      expect(found?.credentials).toEqual({
        botToken: 'bot-token-1',
        publicKey: 'pk-1',
      });
      expect(found?.applicationId).toBe('app-1');
    });

    it('overwrites existing credentials when called again with the same platform', async () => {
      const first = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 'old-token' },
        platform: 'telegram',
      });

      const second = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 'new-token' },
        platform: 'telegram',
      });

      expect(second.id).toBe(first.id);
      const fresh = await SystemBotProviderModel.findById(serverDB, first.id);
      expect(fresh?.credentials).toEqual({ botToken: 'new-token' });
    });

    it('keeps separate rows per platform', async () => {
      const discord = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 'd-token' },
        platform: 'discord',
      });
      const telegram = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 't-token' },
        platform: 'telegram',
      });

      expect(discord.id).not.toBe(telegram.id);
      const all = await SystemBotProviderModel.listAll(serverDB);
      expect(all.length).toBe(2);
    });
  });

  describe('findEnabledByPlatform', () => {
    it('returns the row when enabled', async () => {
      await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 't-1' },
        enabled: true,
        platform: 'discord',
      });

      const found = await SystemBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(found?.platform).toBe('discord');
    });

    it('returns null when the row exists but is disabled', async () => {
      await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 't-1' },
        enabled: false,
        platform: 'discord',
      });

      const found = await SystemBotProviderModel.findEnabledByPlatform(serverDB, 'discord');
      expect(found).toBeNull();
    });

    it('returns null when no row for that platform', async () => {
      const found = await SystemBotProviderModel.findEnabledByPlatform(serverDB, 'slack');
      expect(found).toBeNull();
    });
  });

  describe('findByPlatform', () => {
    it('returns the row regardless of enabled flag', async () => {
      await SystemBotProviderModel.upsertByPlatform(
        serverDB,
        {
          credentials: { botToken: 'disabled-token' },
          enabled: false,
          platform: 'discord',
        },
        mockGateKeeper,
      );

      const found = await SystemBotProviderModel.findByPlatform(
        serverDB,
        'discord',
        mockGateKeeper,
      );
      expect(found?.platform).toBe('discord');
      expect(found?.enabled).toBe(false);
      expect(found?.credentials).toEqual({ botToken: 'disabled-token' });
    });

    it('returns null when no row for that platform', async () => {
      const found = await SystemBotProviderModel.findByPlatform(serverDB, 'slack');
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('re-encrypts credentials when provided and leaves them untouched otherwise', async () => {
      const created = await SystemBotProviderModel.upsertByPlatform(
        serverDB,
        { credentials: { botToken: 'initial' }, platform: 'discord' },
        mockGateKeeper,
      );
      mockGateKeeper.encrypt.mockClear();

      // No credentials in update — encrypt should not be called
      await SystemBotProviderModel.update(serverDB, created.id, { enabled: false }, mockGateKeeper);
      expect(mockGateKeeper.encrypt).not.toHaveBeenCalled();
      const afterMetadata = await SystemBotProviderModel.findById(
        serverDB,
        created.id,
        mockGateKeeper,
      );
      expect(afterMetadata?.enabled).toBe(false);
      expect(afterMetadata?.credentials).toEqual({ botToken: 'initial' });

      // Now update credentials — encrypt should fire
      await SystemBotProviderModel.update(
        serverDB,
        created.id,
        { credentials: { botToken: 'rotated' } },
        mockGateKeeper,
      );
      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(JSON.stringify({ botToken: 'rotated' }));
      const afterRotate = await SystemBotProviderModel.findById(
        serverDB,
        created.id,
        mockGateKeeper,
      );
      expect(afterRotate?.credentials).toEqual({ botToken: 'rotated' });
    });

    it('updates applicationId, settings and connectionMode when provided', async () => {
      const created = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 'initial' },
        platform: 'discord',
      });

      const updated = await SystemBotProviderModel.update(serverDB, created.id, {
        applicationId: 'app-99',
        connectionMode: 'gateway',
        settings: { foo: 'bar' },
      });

      expect(updated?.applicationId).toBe('app-99');
      expect(updated?.connectionMode).toBe('gateway');
      expect(updated?.settings).toEqual({ foo: 'bar' });
    });

    it('returns undefined when updating a non-existent id', async () => {
      const updated = await SystemBotProviderModel.update(
        serverDB,
        '00000000-0000-0000-0000-000000000000',
        { enabled: false },
      );
      expect(updated).toBeUndefined();
    });
  });

  describe('setEnabled', () => {
    it('toggles the enabled flag', async () => {
      const created = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 't' },
        platform: 'discord',
      });
      expect(created.enabled).toBe(true);

      await SystemBotProviderModel.setEnabled(serverDB, created.id, false);
      const fresh = await SystemBotProviderModel.findById(serverDB, created.id);
      expect(fresh?.enabled).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes the row', async () => {
      const created = await SystemBotProviderModel.upsertByPlatform(serverDB, {
        credentials: { botToken: 't' },
        platform: 'discord',
      });

      await SystemBotProviderModel.delete(serverDB, created.id);
      const fresh = await SystemBotProviderModel.findById(serverDB, created.id);
      expect(fresh).toBeNull();
    });
  });

  describe('decryptRow error tolerance', () => {
    it('returns credentials = {} when ciphertext cannot be decrypted', async () => {
      const created = await SystemBotProviderModel.upsertByPlatform(
        serverDB,
        { credentials: { botToken: 't' }, platform: 'discord' },
        mockGateKeeper,
      );

      // GateKeeper that always throws on decrypt — simulates corrupted row
      const broken = {
        decrypt: vi.fn(async () => {
          throw new Error('bad ciphertext');
        }),
        encrypt: vi.fn(async (s: string) => s),
      };
      const found = await SystemBotProviderModel.findById(serverDB, created.id, broken);
      expect(found?.credentials).toEqual({});
    });

    it('returns credentials = {} when the stored ciphertext is empty', async () => {
      const [row] = await serverDB
        .insert(systemBotProviders)
        .values({ credentials: '', platform: 'discord' })
        .returning();

      const found = await SystemBotProviderModel.findById(serverDB, row.id, mockGateKeeper);
      expect(found?.credentials).toEqual({});
      // gateKeeper.decrypt must be skipped entirely for an empty ciphertext
      expect(mockGateKeeper.decrypt).not.toHaveBeenCalled();
    });
  });
});
