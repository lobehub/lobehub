// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearConnectionModel } from '@/database/models/linear';
import { users } from '@/database/schemas';

import { getLinearAccessToken, LinearReconnectRequiredError } from '../token';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ refreshLinearToken: refresh }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
      encrypt: async (plaintext: string) => plaintext,
    }),
  },
}));

const db = await getTestDB();
const userId = 'linear-token-user';

const connect = (tokenExpiresAt: Date | null, refreshToken?: string) =>
  LinearConnectionModel.upsert(db, {
    actorExternalId: 'linear-user',
    actorName: 'Ada',
    credentials: { accessToken: 'old', refreshToken },
    organizationId: 'org-1',
    organizationName: 'Acme',
    organizationUrlKey: 'acme',
    tokenExpiresAt,
    userId,
  });

beforeEach(async () => {
  refresh.mockReset();
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('getLinearAccessToken', () => {
  it('returns a live token without refreshing', async () => {
    const connection = await connect(new Date(Date.now() + 3_600_000), 'refresh');

    expect(await getLinearAccessToken(db, connection.id)).toBe('old');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token and stores the new one', async () => {
    const connection = await connect(new Date(Date.now() + 1000), 'refresh');
    const expiresAt = new Date(Date.now() + 86_400_000);
    refresh.mockResolvedValue({ accessToken: 'new', expiresAt, scopes: ['read'] });

    expect(await getLinearAccessToken(db, connection.id)).toBe('new');
    expect(refresh).toHaveBeenCalledWith('refresh');

    const stored = await LinearConnectionModel.findDecryptedById(db, connection.id);
    // Linear did not rotate the refresh token, so the old one is kept.
    expect(stored?.credentials).toEqual({ accessToken: 'new', refreshToken: 'refresh' });
    expect(stored?.tokenExpiresAt?.getTime()).toBe(expiresAt.getTime());
  });

  it('asks to reconnect when the token cannot be refreshed', async () => {
    const expired = await connect(new Date(Date.now() - 1000));

    await expect(getLinearAccessToken(db, expired.id)).rejects.toBeInstanceOf(
      LinearReconnectRequiredError,
    );
  });

  it('asks to reconnect for a revoked connection', async () => {
    const connection = await connect(null);
    await LinearConnectionModel.revoke(db, connection.id);

    await expect(getLinearAccessToken(db, connection.id)).rejects.toBeInstanceOf(
      LinearReconnectRequiredError,
    );
  });
});
