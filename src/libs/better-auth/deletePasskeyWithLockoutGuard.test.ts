import { account, passkey, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  deletePasskeyWithLockoutGuard,
  PasskeyDeletionResult,
} from './deletePasskeyWithLockoutGuard';

const db = await getTestDB();
const userId = 'passkey-delete-guard-user';

const cleanup = async () => {
  await db.delete(users).where(eq(users.id, userId));
};

const insertPasskeys = async (...ids: string[]) => {
  await db.insert(passkey).values(
    ids.map((id) => ({
      credentialID: `credential-${id}`,
      id,
      publicKey: `public-key-${id}`,
      userId,
    })),
  );
};

const remove = (passkeyId: string, overrides = {}) =>
  deletePasskeyWithLockoutGuard(db, {
    disableEmailPassword: false,
    enabledSSOProviders: [],
    enableMagicLink: false,
    passkeyId,
    userId,
    ...overrides,
  });

describe('deletePasskeyWithLockoutGuard', () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values({ id: userId });
  });

  afterAll(cleanup);

  it('preserves the final passkey when no other usable sign-in method exists', async () => {
    await insertPasskeys('key-a');

    await expect(remove('key-a')).resolves.toBe(PasskeyDeletionResult.WouldLockOut);

    const remaining = await db
      .select({ id: passkey.id })
      .from(passkey)
      .where(eq(passkey.userId, userId));
    expect(remaining).toEqual([{ id: 'key-a' }]);
  });

  it('deletes the final passkey when password sign-in is available', async () => {
    await insertPasskeys('key-a');
    await db.insert(account).values({
      accountId: 'password-account',
      id: 'account-password',
      password: 'hashed-password',
      providerId: 'credential',
      userId,
    });

    await expect(remove('key-a')).resolves.toBe(PasskeyDeletionResult.Deleted);
  });

  it('does not count a credential account without a password', async () => {
    await insertPasskeys('key-a');
    await db.insert(account).values({
      accountId: 'password-account',
      id: 'account-password',
      providerId: 'credential',
      userId,
    });

    await expect(remove('key-a')).resolves.toBe(PasskeyDeletionResult.WouldLockOut);
  });

  it('counts only SSO providers that are still configured', async () => {
    await insertPasskeys('key-a');
    await db.insert(account).values({
      accountId: 'github-account',
      id: 'account-github',
      providerId: 'github',
      userId,
    });

    await expect(remove('key-a')).resolves.toBe(PasskeyDeletionResult.WouldLockOut);
    await expect(remove('key-a', { enabledSSOProviders: ['github'] })).resolves.toBe(
      PasskeyDeletionResult.Deleted,
    );
  });

  it('does not count magic link when the email entry form is disabled', async () => {
    await insertPasskeys('key-a');

    await expect(
      remove('key-a', { disableEmailPassword: true, enableMagicLink: true }),
    ).resolves.toBe(PasskeyDeletionResult.WouldLockOut);
    await expect(remove('key-a', { enableMagicLink: true })).resolves.toBe(
      PasskeyDeletionResult.Deleted,
    );
  });

  it('serializes concurrent deletions so one passkey always survives', async () => {
    await insertPasskeys('key-a', 'key-b');

    const results = await Promise.all([remove('key-a'), remove('key-b')]);

    expect(results).toEqual(
      expect.arrayContaining([PasskeyDeletionResult.Deleted, PasskeyDeletionResult.WouldLockOut]),
    );
    const remaining = await db
      .select({ id: passkey.id })
      .from(passkey)
      .where(eq(passkey.userId, userId));
    expect(remaining).toHaveLength(1);
  });
});
