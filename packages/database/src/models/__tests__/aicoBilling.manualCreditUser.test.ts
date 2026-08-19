import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  platformAdminUsers,
  userWallets,
  walletTransactions,
} from '../../schemas/aicoOrganization';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { AicoBillingModel } from '../aicoBilling';

const serverDB: LobeChatDatabase = await getTestDB();
const billingModel = new AicoBillingModel(serverDB);

const adminId = 'aico-manual-credit-admin';
const operatorId = 'opusr_manual_credit';
const userId = 'aico-manual-credit-user';

beforeEach(async () => {
  await serverDB.delete(walletTransactions);
  await serverDB.delete(userWallets);
  await serverDB.delete(platformAdminUsers);
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'admin@manual-credit.test', id: adminId },
    { email: 'user@manual-credit.test', id: userId },
  ]);
  await serverDB.insert(platformAdminUsers).values({
    email: 'operator@manual-credit.test',
    id: operatorId,
    passwordHash: 'unusable:test',
  });
});

afterEach(async () => {
  await serverDB.delete(walletTransactions);
  await serverDB.delete(userWallets);
  await serverDB.delete(platformAdminUsers);
  await serverDB.delete(users);
});

describe('AicoBillingModel.manualCreditUser', () => {
  it('credits a B2C wallet with type manual_credit', async () => {
    const { wallet, transaction } = await billingModel.manualCreditUser({
      amountMicroUsd: 5_000_000,
      amountToman: 25_000,
      createdByUserId: adminId,
      description: 'Platform adjustment',
      fxRateTomanPerUsd: 5000,
      userId,
    });

    expect(transaction.type).toBe('manual_credit');
    expect(transaction.description).toBe('Platform adjustment');
    expect(transaction.createdByUserId).toBe(adminId);
    expect(transaction.createdByAdminId).toBeNull();
    expect(transaction.userId).toBe(userId);
    expect(transaction.balanceBeforeMicroUsd).toBe(0);
    expect(transaction.balanceAfterMicroUsd).toBe(5_000_000);
    expect(transaction.balanceBeforeToman).toBe(0);
    expect(transaction.balanceAfterToman).toBe(25_000);
    expect(wallet.balanceToman).toBe(25_000);
    expect(wallet.balanceMicroUsd).toBe(5_000_000);
    expect(wallet.isActive).toBe(true);
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      billingModel.manualCreditUser({
        amountMicroUsd: 1,
        amountToman: 0,
        createdByUserId: adminId,
        fxRateTomanPerUsd: 5000,
        userId,
      }),
    ).rejects.toThrow('AMOUNT_TOMAN_MUST_BE_POSITIVE_INTEGER');
  });

  it('stamps createdByAdminId and exposes actor email on the admin ledger', async () => {
    const { transaction } = await billingModel.manualCreditUser({
      amountMicroUsd: 1_000_000,
      amountToman: 5000,
      createdByAdminId: operatorId,
      description: 'Ops credit',
      fxRateTomanPerUsd: 5000,
      userId,
    });
    expect(transaction.createdByAdminId).toBe(operatorId);
    expect(transaction.createdByUserId).toBeNull();

    const rows = await billingModel.listRecentTransactions(10);
    expect(rows[0]?.actorAdminEmail).toBe('operator@manual-credit.test');
    expect(rows[0]?.userEmail).toBe('user@manual-credit.test');
    expect(rows[0]?.description).toBe('Ops credit');
  });
});
