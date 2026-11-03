// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { linearConnections, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { LinearConnectionModel } from '../connection';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-conn-user';
const otherUserId = 'linear-conn-other';
const workspaceId = 'linear-conn-ws';

const organization = {
  actorExternalId: 'linear-user-1',
  actorName: 'Ada',
  organizationId: 'org-1',
  organizationName: 'Acme',
  organizationUrlKey: 'acme',
};

/** Reversible stand-in for KeyVaultsGateKeeper. */
const gateKeeper = {
  decrypt: async (ciphertext: string) => ({ plaintext: ciphertext.replace(/^enc:/, '') }),
  encrypt: async (plaintext: string) => `enc:${plaintext}`,
};

beforeEach(async () => {
  await db.delete(linearConnections);
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await db.delete(linearConnections);
  await db.delete(users);
});

describe('LinearConnectionModel', () => {
  it('stores the token encrypted and decrypts it on read', async () => {
    const row = await LinearConnectionModel.upsert(
      db,
      { ...organization, credentials: { accessToken: 'tok', refreshToken: 'ref' }, userId },
      gateKeeper,
    );

    expect(row.credentials).toBe('enc:{"accessToken":"tok","refreshToken":"ref"}');
    expect(row).toMatchObject({ metadata: {}, revokedAt: null, workspaceId: null });

    const decrypted = await LinearConnectionModel.findDecryptedById(db, row.id, gateKeeper);
    expect(decrypted?.credentials).toEqual({ accessToken: 'tok', refreshToken: 'ref' });
  });

  it('re-authorizing the same organization from the same scope refreshes the row', async () => {
    const first = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'old' },
      userId,
    });
    await LinearConnectionModel.revoke(db, first.id);

    const second = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'new' },
      organizationName: 'Acme Inc',
      userId,
    });

    expect(second.id).toBe(first.id);
    expect(second.revokedAt).toBeNull();
    expect(second.organizationName).toBe('Acme Inc');
    expect(JSON.parse(second.credentials!)).toEqual({ accessToken: 'new' });
  });

  it('keeps personal and workspace connections to one organization apart', async () => {
    const personal = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'a' },
      userId,
    });
    const workspace = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'b' },
      userId,
      workspaceId,
    });

    expect(workspace.id).not.toBe(personal.id);

    const personalList = await LinearConnectionModel.listByScope(db, { userId });
    expect(personalList.map((row) => row.id)).toEqual([personal.id]);

    // Workspace scope lists every member's connection, not only the caller's.
    const workspaceList = await LinearConnectionModel.listByScope(db, {
      userId: otherUserId,
      workspaceId,
    });
    expect(workspaceList.map((row) => row.id)).toEqual([workspace.id]);
  });

  it('revoking drops the token and hides the connection', async () => {
    const row = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'a' },
      tokenExpiresAt: new Date(),
      userId,
    });

    await LinearConnectionModel.revoke(db, row.id);

    const revoked = await LinearConnectionModel.findById(db, row.id);
    expect(revoked).toMatchObject({ credentials: null, tokenExpiresAt: null });
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await LinearConnectionModel.listByScope(db, { userId })).toEqual([]);
  });

  it('exposes a view without credentials', async () => {
    const row = await LinearConnectionModel.upsert(db, {
      ...organization,
      credentials: { accessToken: 'a' },
      userId,
    });

    const view = LinearConnectionModel.toView((await LinearConnectionModel.findById(db, row.id))!);
    expect(view).not.toHaveProperty('credentials');
    expect(view).toMatchObject({ organizationName: 'Acme', userId });
  });
});
