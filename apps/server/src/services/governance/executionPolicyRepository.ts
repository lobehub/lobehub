import type { LobeChatDatabase } from '@lobechat/database';
import { eq } from 'drizzle-orm';

import { userExecutionPolicies } from '@/database/schemas';

import type { UserExecutionPolicyCommandMode, UserExecutionPolicyItem } from './types';

export interface UpsertExecutionPolicyParams {
  allowedNetworkDomains?: string[];
  allowNetwork?: boolean;
  commandMode?: UserExecutionPolicyCommandMode;
  createdBy?: string;
  deniedReadRoots?: string[];
  deniedWriteRoots?: string[];
  enabled?: boolean;
  envAllowlist?: string[];
  readableRoots?: string[];
  writableRoots?: string[];
}

/**
 * CRUD against `user_execution_policies`, consumed by the `/api/governance`
 * HTTP handlers (admin panel) and `getUserExecutionPolicy` (the CLI/desktop
 * fetch path). One row per user — `getForUser` is the hot lookup, `upsert`
 * always targets the same row via the table's unique `userId` constraint.
 */

export const getPolicyForUser = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<UserExecutionPolicyItem | undefined> => {
  const [row] = await db
    .select()
    .from(userExecutionPolicies)
    .where(eq(userExecutionPolicies.userId, userId));

  return row;
};

/** Insert-or-update the single policy row for a user (admin panel save). */
export const upsertPolicyForUser = async (
  db: LobeChatDatabase,
  userId: string,
  patch: UpsertExecutionPolicyParams,
): Promise<UserExecutionPolicyItem> => {
  const [row] = await db
    .insert(userExecutionPolicies)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      set: { ...patch, updatedAt: new Date() },
      target: userExecutionPolicies.userId,
    })
    .returning();

  return row;
};

/** Delete = restore the user to unrestricted (no row = no policy). */
export const deletePolicyForUser = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<boolean> => {
  const deleted = await db
    .delete(userExecutionPolicies)
    .where(eq(userExecutionPolicies.userId, userId))
    .returning({ id: userExecutionPolicies.id });

  return deleted.length > 0;
};
