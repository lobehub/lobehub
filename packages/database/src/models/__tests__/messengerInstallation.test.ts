// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messengerInstallations, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MessengerInstallationModel } from '../messengerInstallation';

const serverDB: LobeChatDatabase = await getTestDB();

const installerUserId = 'messenger-install-test-user-id';
const installerUserId2 = 'messenger-install-test-user-id-2';

const mockGateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
  encrypt: vi.fn(async (plaintext: string) => plaintext),
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: installerUserId }, { id: installerUserId2 }]);
});

afterEach(async () => {
  await serverDB.delete(messengerInstallations);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

describe('MessengerInstallationModel', () => {
  describe('upsert', () => {
    it('inserts a new install row with encrypted credentials', async () => {
      const created = await MessengerInstallationModel.upsert(
        serverDB,
        {
          accountId: 'U_BOT_1',
          applicationId: 'A_APP_1',
          credentials: { botToken: 'xoxb-abc' },
          installedByUserId: installerUserId,
          metadata: { tenantName: 'Acme' },
          platform: 'slack',
          tenantId: 'T_ACME',
        },
        mockGateKeeper,
      );

      expect(created.id).toBeDefined();
      expect(created.platform).toBe('slack');
      expect(created.tenantId).toBe('T_ACME');
      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(JSON.stringify({ botToken: 'xoxb-abc' }));
    });

    it('updates the same row on re-install (same platform+app+tenant)', async () => {
      const first = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-old' },
        platform: 'slack',
        tenantId: 'T_ACME',
      });

      const second = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-new' },
        platform: 'slack',
        tenantId: 'T_ACME',
      });

      expect(second.id).toBe(first.id);
      const fresh = await MessengerInstallationModel.findById(serverDB, first.id);
      expect(fresh?.credentials).toEqual({ botToken: 'xoxb-new' });
    });

    it('clears revoked_at on re-install', async () => {
      const created = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-1' },
        platform: 'slack',
        tenantId: 'T_ACME',
      });
      await MessengerInstallationModel.markRevoked(serverDB, created.id);

      const reinstalled = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-2' },
        platform: 'slack',
        tenantId: 'T_ACME',
      });

      expect(reinstalled.revokedAt).toBeNull();
    });

    it('treats different tenants under the same app as separate rows', async () => {
      const a = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-a' },
        platform: 'slack',
        tenantId: 'T_A',
      });
      const b = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-b' },
        platform: 'slack',
        tenantId: 'T_B',
      });

      expect(a.id).not.toBe(b.id);
    });
  });

  describe('findByTenant', () => {
    it('returns the matching row decrypted', async () => {
      await MessengerInstallationModel.upsert(
        serverDB,
        {
          applicationId: 'A_APP_1',
          credentials: { botToken: 'xoxb-found' },
          platform: 'slack',
          tenantId: 'T_FOUND',
        },
        mockGateKeeper,
      );

      const found = await MessengerInstallationModel.findByTenant(
        serverDB,
        'slack',
        'T_FOUND',
        'A_APP_1',
        mockGateKeeper,
      );

      expect(found?.credentials).toEqual({ botToken: 'xoxb-found' });
    });

    it('skips revoked rows', async () => {
      const row = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-x' },
        platform: 'slack',
        tenantId: 'T_X',
      });
      await MessengerInstallationModel.markRevoked(serverDB, row.id);

      const found = await MessengerInstallationModel.findByTenant(serverDB, 'slack', 'T_X');
      expect(found).toBeNull();
    });

    it('returns null when no row exists', async () => {
      const found = await MessengerInstallationModel.findByTenant(serverDB, 'slack', 'T_MISSING');
      expect(found).toBeNull();
    });
  });

  describe('listByInstallerUserId', () => {
    it('returns only installs the given LobeHub user kicked off', async () => {
      await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-1' },
        installedByUserId: installerUserId,
        platform: 'slack',
        tenantId: 'T_1',
      });
      await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-2' },
        installedByUserId: installerUserId2,
        platform: 'slack',
        tenantId: 'T_2',
      });

      const mine = await MessengerInstallationModel.listByInstallerUserId(
        serverDB,
        installerUserId,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].tenantId).toBe('T_1');
    });
  });

  describe('updateRotatedToken', () => {
    it('writes new credentials and expiry atomically', async () => {
      const created = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-old', refreshToken: 'r-old' },
        platform: 'slack',
        tenantId: 'T_ROT',
        tokenExpiresAt: new Date(Date.now() + 1000),
      });

      const newExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000);
      await MessengerInstallationModel.updateRotatedToken(serverDB, created.id, {
        credentials: { botToken: 'xoxb-new', refreshToken: 'r-new' },
        tokenExpiresAt: newExpiry,
      });

      const fresh = await MessengerInstallationModel.findById(serverDB, created.id);
      expect(fresh?.credentials).toEqual({ botToken: 'xoxb-new', refreshToken: 'r-new' });
      expect(fresh?.tokenExpiresAt?.getTime()).toBe(newExpiry.getTime());
    });
  });

  describe('listExpiringSoon', () => {
    it('returns active installs whose token expires within the window', async () => {
      const expiringSoon = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-soon' },
        platform: 'slack',
        tenantId: 'T_SOON',
        tokenExpiresAt: new Date(Date.now() + 60 * 1000),
      });
      await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-later' },
        platform: 'slack',
        tenantId: 'T_LATER',
        tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      const revoked = await MessengerInstallationModel.upsert(serverDB, {
        applicationId: 'A_APP_1',
        credentials: { botToken: 'xoxb-rev' },
        platform: 'slack',
        tenantId: 'T_REV',
        tokenExpiresAt: new Date(Date.now() + 60 * 1000),
      });
      await MessengerInstallationModel.markRevoked(serverDB, revoked.id);

      const expiring = await MessengerInstallationModel.listExpiringSoon(
        serverDB,
        5 * 60 * 1000, // 5 min window
      );
      const ids = expiring.map((r) => r.id);
      expect(ids).toContain(expiringSoon.id);
      expect(ids).not.toContain(revoked.id);
    });
  });

  describe('credentials encryption round-trip', () => {
    it('encrypts on insert and decrypts on read with a real-shape gateKeeper', async () => {
      const reverseEncrypt = vi.fn(async (plaintext: string) =>
        Buffer.from(plaintext, 'utf8').toString('base64'),
      );
      const reverseDecrypt = vi.fn(async (ciphertext: string) => ({
        plaintext: Buffer.from(ciphertext, 'base64').toString('utf8'),
      }));
      const realishGate = { decrypt: reverseDecrypt, encrypt: reverseEncrypt };

      const created = await MessengerInstallationModel.upsert(
        serverDB,
        {
          applicationId: 'A_APP_1',
          credentials: { botToken: 'xoxb-roundtrip', refreshToken: 'r-rt' },
          platform: 'slack',
          tenantId: 'T_RT',
        },
        realishGate,
      );

      const found = await MessengerInstallationModel.findById(serverDB, created.id, realishGate);
      expect(found?.credentials).toEqual({
        botToken: 'xoxb-roundtrip',
        refreshToken: 'r-rt',
      });
    });
  });
});
