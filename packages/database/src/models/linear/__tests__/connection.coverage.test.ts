// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { linearConnections, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { LinearConnectionModel } from '../connection';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-conn-coverage-user';

const organization = {
  actorExternalId: 'linear-cov-actor',
  actorName: 'Ada',
  organizationId: 'linear-cov-org',
  organizationName: 'Acme',
  organizationUrlKey: 'acme-cov',
};

/** Reversible stand-in for KeyVaultsGateKeeper. */
const gateKeeper = {
  decrypt: async (ciphertext: string) => ({ plaintext: ciphertext.replace(/^enc:/, '') }),
  encrypt: async (plaintext: string) => `enc:${plaintext}`,
};

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Connections cascade with their owner.
  await db.delete(users).where(inArray(users.id, [userId]));
});

describe('LinearConnectionModel coverage', () => {
  it('returns null for an unknown connection id', async () => {
    const missingId = '00000000-0000-4000-8000-000000000000';

    expect(await LinearConnectionModel.findById(db, missingId)).toBeNull();
    expect(await LinearConnectionModel.findDecryptedById(db, missingId)).toBeNull();
  });

  it('reads a token stored without a gate keeper as plain JSON', async () => {
    const row = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'plain' },
      userId,
    });

    expect(row.credentials).toBe('{"accessToken":"plain"}');
    const decrypted = await LinearConnectionModel.findDecryptedById(db, row.id);
    expect(decrypted?.credentials).toEqual({ accessToken: 'plain' });
  });

  it('decrypts a revoked connection to null credentials', async () => {
    const row = await LinearConnectionModel.upsert(
      db,
      { ...organization, credentials: { accessToken: 'a' }, userId },
      gateKeeper,
    );
    await LinearConnectionModel.revoke(db, row.id);

    const decrypted = await LinearConnectionModel.findDecryptedById(db, row.id, gateKeeper);
    expect(decrypted).toMatchObject({ credentials: null, id: row.id });
  });

  it('treats a token that does not parse as JSON as missing', async () => {
    const [row] = await db
      .insert(linearConnections)
      .values({ ...organization, credentials: 'not-json', userId })
      .returning();

    const decrypted = await LinearConnectionModel.findDecryptedById(db, row.id);
    expect(decrypted).toMatchObject({ credentials: null, id: row.id });
  });
});
