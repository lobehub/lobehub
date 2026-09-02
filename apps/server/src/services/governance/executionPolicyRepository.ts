import type { LobeChatDatabase } from '@lobechat/database';
import { count, desc, eq } from 'drizzle-orm';

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

export interface ListAllPoliciesResult {
  items: UserExecutionPolicyItem[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Every configured policy across every user, most recently updated first —
 * the admin panel's overview table, mirroring `listAllRules` in
 * `rulesRepository.ts`.
 */
export const listAllPolicies = async (
  db: LobeChatDatabase,
  { page = 1, pageSize = DEFAULT_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<ListAllPoliciesResult> => {
  const clampedPage = Math.max(1, page);
  const clampedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));

  const [items, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(userExecutionPolicies)
      .orderBy(desc(userExecutionPolicies.updatedAt))
      .limit(clampedPageSize)
      .offset((clampedPage - 1) * clampedPageSize),
    db.select({ value: count() }).from(userExecutionPolicies),
  ]);

  return { items, page: clampedPage, pageSize: clampedPageSize, total };
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
