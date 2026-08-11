/**
 * OR-001 — soft-delete outbox action disable_user_key must disable the personal OR key.
 */
// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { users } from '@/database/schemas';
import {
  aicoAccountTombs,
  aicoKeyOutbox,
  userWallets,
  walletTransactions,
} from '@/database/schemas/aicoOrganization';
import { processKeyOutbox } from '@/server/services/aico/renewalScheduler';
import { AicoSoftDeleteService } from '@/server/services/aico/softDelete';
import type { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

const userId = 'or-001-soft-delete-user';

describe('OR-001 processKeyOutbox disable_user_key', () => {
  let db: LobeChatDatabase;

  beforeEach(async () => {
    db = await getTestDB();
    await db.delete(aicoKeyOutbox);
    await db.delete(aicoAccountTombs);
    await db.delete(walletTransactions);
    await db.delete(userWallets);
    await db.delete(users);
    await db.insert(users).values({ email: 'or001@example.com', id: userId });
  });

  afterEach(async () => {
    await db.delete(aicoKeyOutbox);
    await db.delete(aicoAccountTombs);
    await db.delete(walletTransactions);
    await db.delete(userWallets);
    await db.delete(users);
  });

  it('soft-delete enqueues disable_user_key and outbox disables the personal key', async () => {
    const billing = new AicoBillingModel(db);
    await billing.manualCreditUser({
      amountMicroUsd: 5_000_000,
      amountToman: 25_000,
      createdByUserId: userId,
      fxRateTomanPerUsd: 5000,
      userId,
    });
    await billing.updateUserOpenRouterKey({
      ciphertext: 'cipher',
      keyId: 'or-key-personal',
      userId,
    });

    const softDelete = new AicoSoftDeleteService(db);
    await softDelete.softDeleteUser({ deletedByUserId: userId, userId });

    const pending = await db
      .select()
      .from(aicoKeyOutbox)
      .where(and(eq(aicoKeyOutbox.userId, userId), eq(aicoKeyOutbox.action, 'disable_user_key')));
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');

    const disableUserKey = vi.fn(async () => ({ disabled: true, hash: 'or-key-personal' }));
    const keyService = {
      disableUserKey,
    } as unknown as AicoOpenRouterKeyService;

    const result = await processKeyOutbox(db, { keyService });
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
    expect(disableUserKey).toHaveBeenCalledWith(userId);

    const rows = await db
      .select()
      .from(aicoKeyOutbox)
      .where(and(eq(aicoKeyOutbox.userId, userId), eq(aicoKeyOutbox.action, 'disable_user_key')));
    expect(rows.every((r) => r.status === 'succeeded')).toBe(true);
  });
});
