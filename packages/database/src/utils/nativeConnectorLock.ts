import { sql } from 'drizzle-orm';

import type { LobeChatDatabase, Transaction } from '../type';

export const nativeConnectorLockKey = (userId: string, identifier: string) =>
  `personal-connector:${userId}:${identifier}`;

/** Shared by grant/identity transitions and actual dispatch, across server processes.
 * An already accepted provider request finishes before local stop can commit.
 * Live resolution and dispatch must both run inside this boundary.
 */
export const withNativeConnectorLock = <T>(
  db: LobeChatDatabase,
  userId: string,
  identifier: string,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${nativeConnectorLockKey(userId, identifier)}))`,
    );
    return run(tx);
  });
