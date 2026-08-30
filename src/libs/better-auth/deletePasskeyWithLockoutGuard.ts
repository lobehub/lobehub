import { type LobeChatDatabase } from '@lobechat/database';
import { account, passkey, users } from '@lobechat/database/schemas';
import { and, eq } from 'drizzle-orm';

export const PasskeyDeletionResult = {
  Deleted: 'deleted',
  NotFound: 'notFound',
  WouldLockOut: 'wouldLockOut',
} as const;

export type PasskeyDeletionResult =
  (typeof PasskeyDeletionResult)[keyof typeof PasskeyDeletionResult];

export interface DeletePasskeyWithLockoutGuardInput {
  disableEmailPassword: boolean;
  enabledSSOProviders: readonly string[];
  enableMagicLink: boolean;
  passkeyId: string;
  userId: string;
}

/**
 * Delete one owned passkey without allowing two concurrent requests to remove
 * every credential. Locking the user row gives every passkey deletion for an
 * account the same serialization point; the later transaction then re-reads
 * the committed credential set instead of trusting a stale client snapshot.
 */
export const deletePasskeyWithLockoutGuard = async (
  db: LobeChatDatabase,
  input: DeletePasskeyWithLockoutGuardInput,
): Promise<PasskeyDeletionResult> => {
  const enabledSSOProviders = new Set(input.enabledSSOProviders);

  return db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update');

    if (!lockedUser) return PasskeyDeletionResult.NotFound;

    const ownedPasskeys = await tx
      .select({ id: passkey.id })
      .from(passkey)
      .where(eq(passkey.userId, input.userId));

    if (!ownedPasskeys.some(({ id }) => id === input.passkeyId)) {
      return PasskeyDeletionResult.NotFound;
    }

    const hasAnotherPasskey = ownedPasskeys.some(({ id }) => id !== input.passkeyId);

    if (!hasAnotherPasskey) {
      const canUseMagicLink = input.enableMagicLink && !input.disableEmailPassword;
      const accounts = await tx
        .select({ password: account.password, providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, input.userId));
      const canUsePassword =
        !input.disableEmailPassword &&
        accounts.some(
          ({ password, providerId }) =>
            providerId === 'credential' && typeof password === 'string' && password.length > 0,
        );
      const canUseConfiguredSSO = accounts.some(({ providerId }) =>
        enabledSSOProviders.has(providerId),
      );

      if (!canUseMagicLink && !canUsePassword && !canUseConfiguredSSO) {
        return PasskeyDeletionResult.WouldLockOut;
      }
    }

    await tx
      .delete(passkey)
      .where(and(eq(passkey.id, input.passkeyId), eq(passkey.userId, input.userId)));

    return PasskeyDeletionResult.Deleted;
  });
};
