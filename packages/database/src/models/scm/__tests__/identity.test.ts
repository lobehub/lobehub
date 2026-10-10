// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { scmIdentities, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmIdentityModel } from '../identity';

const serverDB: LobeChatDatabase = await getTestDB();

const provider = 'github';
const userA = 'scm-identity-user-a';
const userB = 'scm-identity-user-b';

beforeEach(async () => {
  await serverDB.delete(scmIdentities);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
});

afterEach(async () => {
  await serverDB.delete(scmIdentities);
  await serverDB.delete(users);
});

describe('ScmIdentityModel', () => {
  describe('findByExternalUser', () => {
    it('resolves a bound provider account and returns null for an unknown one', async () => {
      await ScmIdentityModel.upsert(serverDB, {
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      const found = await ScmIdentityModel.findByExternalUser(serverDB, provider, 'gh-1');
      expect(found).toMatchObject({
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      expect(
        await ScmIdentityModel.findByExternalUser(serverDB, provider, 'gh-unknown'),
      ).toBeNull();
    });
  });

  describe('findByUser', () => {
    it('returns null when the user never authorized the provider', async () => {
      expect(await ScmIdentityModel.findByUser(serverDB, provider, userA)).toBeNull();
    });

    it('returns null credentials when the row carries none', async () => {
      await ScmIdentityModel.upsert(serverDB, {
        credentials: null,
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      const found = await ScmIdentityModel.findByUser(serverDB, provider, userA);
      expect(found).toMatchObject({ credentials: null, externalLogin: 'arvin' });
    });

    it('reads credentials back as plaintext when no gatekeeper is supplied', async () => {
      await ScmIdentityModel.upsert(serverDB, {
        credentials: { accessToken: 'gho_plain' },
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      const found = await ScmIdentityModel.findByUser(serverDB, provider, userA);
      expect(found?.credentials).toEqual({ accessToken: 'gho_plain' });
    });

    it('decrypts through the gatekeeper, writing only ciphertext', async () => {
      const gateKeeper = {
        decrypt: vi.fn(async (ciphertext: string) => ({
          plaintext: ciphertext.replace('cipher:', ''),
        })),
        encrypt: vi.fn(async (plaintext: string) => `cipher:${plaintext}`),
      };
      const credentials = { accessToken: 'gho_secret', refreshToken: 'ghr_secret' };

      await ScmIdentityModel.upsert(
        serverDB,
        { credentials, externalLogin: 'arvin', externalUserId: 'gh-1', provider, userId: userA },
        gateKeeper,
      );

      expect(gateKeeper.encrypt).toHaveBeenCalledWith(JSON.stringify(credentials));

      // The stored column never holds the plaintext payload.
      const [stored] = await serverDB
        .select()
        .from(scmIdentities)
        .where(eq(scmIdentities.userId, userA));
      expect(stored.credentials).toBe(`cipher:${JSON.stringify(credentials)}`);

      const found = await ScmIdentityModel.findByUser(serverDB, provider, userA, gateKeeper);
      expect(found?.credentials).toEqual(credentials);
    });

    it('falls back to null credentials when the stored payload is not JSON', async () => {
      await serverDB.insert(scmIdentities).values({
        credentials: 'not-json',
        externalLogin: 'arvin',
        externalUserId: 'gh-broken',
        provider,
        userId: userA,
      });

      const found = await ScmIdentityModel.findByUser(serverDB, provider, userA);
      expect(found?.credentials).toBeNull();
    });
  });

  describe('upsert', () => {
    it('creates the identity on first authorization', async () => {
      const row = await ScmIdentityModel.upsert(serverDB, {
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        metadata: { avatarUrl: 'https://example.com/a.png' },
        provider,
        tokenExpiresAt: null,
        userId: userA,
      });

      expect(row).toMatchObject({
        externalLogin: 'arvin',
        metadata: { avatarUrl: 'https://example.com/a.png' },
        tokenExpiresAt: null,
        userId: userA,
      });
      // No credentials param at all -> the column stays null, not `undefined`.
      expect(row.credentials).toBeNull();
    });

    it('updates the account in place on re-authorization', async () => {
      await ScmIdentityModel.upsert(serverDB, {
        credentials: { accessToken: 'gho_old' },
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      const row = await ScmIdentityModel.upsert(serverDB, {
        credentials: { accessToken: 'gho_new' },
        externalLogin: 'arvin-renamed',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      expect(row).toMatchObject({ externalLogin: 'arvin-renamed', userId: userA });

      const rows = await serverDB
        .select()
        .from(scmIdentities)
        .where(eq(scmIdentities.externalUserId, 'gh-1'));
      expect(rows).toHaveLength(1);
    });

    it('keeps the stored credentials when the param omits them', async () => {
      await ScmIdentityModel.upsert(serverDB, {
        credentials: { accessToken: 'gho_keep' },
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      await ScmIdentityModel.upsert(serverDB, {
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      const [row] = await serverDB
        .select()
        .from(scmIdentities)
        .where(eq(scmIdentities.externalUserId, 'gh-1'));
      expect(row.credentials).toBe(JSON.stringify({ accessToken: 'gho_keep' }));
    });

    it('throws when the provider account already belongs to another user', async () => {
      await ScmIdentityModel.upsert(serverDB, {
        credentials: { accessToken: 'gho_owner' },
        externalLogin: 'arvin',
        externalUserId: 'gh-1',
        provider,
        userId: userA,
      });

      await expect(
        ScmIdentityModel.upsert(serverDB, {
          credentials: { accessToken: 'gho_attacker' },
          externalLogin: 'arvin',
          externalUserId: 'gh-1',
          provider,
          userId: userB,
        }),
      ).rejects.toThrow(/belongs to another user/);

      // The original owner keeps the row and the token.
      const [row] = await serverDB
        .select()
        .from(scmIdentities)
        .where(eq(scmIdentities.externalUserId, 'gh-1'));
      expect(row.userId).toBe(userA);
      expect(row.credentials).toBe(JSON.stringify({ accessToken: 'gho_owner' }));
    });
  });
});
