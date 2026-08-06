/**
 * getUserRemaining — personal spendable balance from OpenRouter limit_remaining
 */
// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { users } from '@/database/schemas';
import { userWallets, walletTransactions } from '@/database/schemas/aicoOrganization';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import type { OpenRouterManagementClient } from '@/server/services/openrouter/management';

class ControllableOpenRouterClient implements OpenRouterManagementClient {
  keys = new Map<string, any>();

  createKey: OpenRouterManagementClient['createKey'] = async (params) => {
    const hash = `ctrl_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const row = {
      disabled: false,
      hash,
      key: `sk-or-v1-mock-${hash}`,
      limit: params.limitUsd,
      limitRemaining: params.limitUsd,
      name: params.name,
      usage: 0,
    };
    this.keys.set(hash, row);
    return { ...row };
  };

  getKey: OpenRouterManagementClient['getKey'] = async (hash) => {
    const row = this.keys.get(hash);
    if (!row) throw new Error(`OpenRouter mock key not found: ${hash}`);
    const { key: _k, ...info } = row;
    return info;
  };

  updateKey: OpenRouterManagementClient['updateKey'] = async (params) => {
    const row = this.keys.get(params.hash);
    if (!row) throw new Error(`OpenRouter mock key not found: ${params.hash}`);
    if (params.disabled !== undefined) row.disabled = params.disabled;
    if (params.limitUsd !== undefined) {
      row.limit = params.limitUsd;
      row.limitRemaining = Math.max(0, params.limitUsd - row.usage);
    }
    const { key: _k, ...info } = row;
    return info;
  };
}

describe('getUserRemaining', () => {
  let db: LobeChatDatabase;
  const userId = 'user_remaining_test';

  beforeEach(async () => {
    db = await getTestDB();
    await db.delete(walletTransactions);
    await db.delete(userWallets);
    await db.delete(users);
    await db.insert(users).values({ id: userId, username: 'remaining-user' });
  });

  afterEach(async () => {
    await db.delete(walletTransactions);
    await db.delete(userWallets);
    await db.delete(users);
  });

  it('prefers OpenRouter limit_remaining over deposited balance', async () => {
    const billing = new AicoBillingModel(db);
    const client = new ControllableOpenRouterClient();
    const keys = new AicoOpenRouterKeyService(db, client);

    await billing.mockTopupUser({
      amountMicroUsd: 10_000_000,
      amountToman: 50_000,
      createdByUserId: userId,
      fxRateTomanPerUsd: 50_000,
      userId,
    });
    await keys.ensureUserKey(userId);

    const wallet = await billing.getUserWallet(userId);
    const keyHash = wallet!.openrouterKeyId!;
    const key = client.keys.get(keyHash);
    key.usage = 2.5;
    key.limitRemaining = 7.5;

    const remaining = await keys.getUserRemaining(userId);
    expect(remaining.remainingMicroUsd).toBe(7_500_000);
    expect(remaining.usageMicroUsd).toBe(2_500_000);
  });

  it('falls back to deposit when OpenRouter key is missing', async () => {
    const billing = new AicoBillingModel(db);
    const client = new ControllableOpenRouterClient();
    const keys = new AicoOpenRouterKeyService(db, client);

    await billing.mockTopupUser({
      amountMicroUsd: 10_000_000,
      amountToman: 50_000,
      createdByUserId: userId,
      fxRateTomanPerUsd: 50_000,
      userId,
    });

    const remaining = await keys.getUserRemaining(userId);
    expect(remaining.remainingMicroUsd).toBe(10_000_000);
    expect(remaining.usageMicroUsd).toBeNull();
  });

  it('falls back to deposit when OpenRouter getKey fails', async () => {
    const billing = new AicoBillingModel(db);
    const client = new ControllableOpenRouterClient();
    const keys = new AicoOpenRouterKeyService(db, client);

    await billing.mockTopupUser({
      amountMicroUsd: 3_000_000,
      amountToman: 15_000,
      createdByUserId: userId,
      fxRateTomanPerUsd: 50_000,
      userId,
    });
    await billing.updateUserOpenRouterKey({
      ciphertext: 'cipher',
      keyId: 'missing-key-hash',
      userId,
    });

    const remaining = await keys.getUserRemaining(userId);
    expect(remaining.remainingMicroUsd).toBe(3_000_000);
    expect(remaining.usageMicroUsd).toBeNull();
  });
});
