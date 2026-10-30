// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { scmIdentities, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmIdentityModel } from '../identity';

const db: LobeChatDatabase = await getTestDB();

const userId = 'scm-identity-user';
const otherUserId = 'scm-identity-other';

const baseParams = {
  externalLogin: 'octocat',
  externalUserId: 'ext-42',
  provider: 'github' as const,
  userId,
};

const credentials = { accessToken: 'ghu_token', refreshToken: 'ghr_token' };

beforeEach(async () => {
  await db.delete(scmIdentities);
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await db.delete(scmIdentities);
  await db.delete(users);
});

describe('ScmIdentityModel', () => {
  it('creates an identity with defaults and reads it back by provider account', async () => {
    const row = await ScmIdentityModel.upsert(db, baseParams);

    expect(row).toMatchObject({
      credentials: null,
      externalLogin: 'octocat',
      metadata: {},
      provider: 'github',
      tokenExpiresAt: null,
      userId,
    });

    await expect(
      ScmIdentityModel.findByExternalUser(db, 'github', 'ext-42'),
    ).resolves.toMatchObject({ id: row.id });

    // No gatekeeper: a null credential column stays null.
    await expect(ScmIdentityModel.findByUser(db, 'github', userId)).resolves.toMatchObject({
      credentials: null,
      id: row.id,
    });
  });

  it('round-trips credentials as plaintext JSON when no gatekeeper is provided', async () => {
    await ScmIdentityModel.upsert(db, { ...baseParams, credentials });

    const [stored] = await db
      .select()
      .from(scmIdentities)
      .where(eq(scmIdentities.userId, userId))
      .limit(1);
    expect(stored.credentials).toBe(JSON.stringify(credentials));

    const identity = await ScmIdentityModel.findByUser(db, 'github', userId);
    expect(identity?.credentials).toEqual(credentials);
  });

  it('encrypts on write and decrypts on read through the gatekeeper', async () => {
    const gateKeeper = {
      decrypt: vi.fn(async (ciphertext: string) => ({
        plaintext: Buffer.from(ciphertext, 'base64').toString(),
      })),
      encrypt: vi.fn(async (plaintext: string) => Buffer.from(plaintext).toString('base64')),
    };

    await ScmIdentityModel.upsert(db, { ...baseParams, credentials }, gateKeeper);

    const [stored] = await db
      .select()
      .from(scmIdentities)
      .where(eq(scmIdentities.userId, userId))
      .limit(1);
    expect(stored.credentials).not.toBe(JSON.stringify(credentials));
    expect(gateKeeper.encrypt).toHaveBeenCalledWith(JSON.stringify(credentials));

    const identity = await ScmIdentityModel.findByUser(db, 'github', userId, gateKeeper);
    expect(identity?.credentials).toEqual(credentials);
    expect(gateKeeper.decrypt).toHaveBeenCalledWith(stored.credentials);
  });

  it('keeps stored credentials when a re-authorization omits them', async () => {
    const created = await ScmIdentityModel.upsert(db, { ...baseParams, credentials });

    const updated = await ScmIdentityModel.upsert(db, {
      ...baseParams,
      externalLogin: 'octocat-renamed',
      metadata: { scopes: ['repo'] },
      tokenExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({
      credentials: JSON.stringify(credentials),
      externalLogin: 'octocat-renamed',
      metadata: { scopes: ['repo'] },
    });
    expect(updated.tokenExpiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('clears credentials when the caller explicitly passes null', async () => {
    await ScmIdentityModel.upsert(db, { ...baseParams, credentials });

    const cleared = await ScmIdentityModel.upsert(db, { ...baseParams, credentials: null });

    expect(cleared.credentials).toBeNull();
  });

  it('returns null for an unknown provider account or user', async () => {
    await expect(ScmIdentityModel.findByExternalUser(db, 'github', 'missing')).resolves.toBeNull();
    await expect(ScmIdentityModel.findByUser(db, 'github', 'missing-user')).resolves.toBeNull();
  });

  it('returns null credentials when the stored payload is not JSON', async () => {
    await ScmIdentityModel.upsert(db, baseParams);
    await db
      .update(scmIdentities)
      .set({ credentials: 'not-json' })
      .where(eq(scmIdentities.userId, userId));

    await expect(ScmIdentityModel.findByUser(db, 'github', userId)).resolves.toMatchObject({
      credentials: null,
    });
  });

  it('throws when the provider account is already bound to another user', async () => {
    const created = await ScmIdentityModel.upsert(db, baseParams);

    await expect(
      ScmIdentityModel.upsert(db, { ...baseParams, externalLogin: 'hijack', userId: otherUserId }),
    ).rejects.toThrow('belongs to another user');

    // The original binding is untouched.
    const [stored] = await db.select().from(scmIdentities).where(eq(scmIdentities.id, created.id));
    expect(stored).toMatchObject({ externalLogin: 'octocat', userId });
  });
});
