import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  platformTrialConfig,
  trialAbuseBlocklist,
  userTrials,
  userWallets,
  walletTransactions,
} from '../../schemas/aicoOrganization';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { AicoBillingModel } from '../aicoBilling';

const serverDB: LobeChatDatabase = await getTestDB();
const model = new AicoBillingModel(serverDB);
const userId = 'aico-billing-user';

beforeEach(async () => {
  await serverDB.delete(trialAbuseBlocklist);
  await serverDB.delete(userTrials);
  await serverDB.delete(platformTrialConfig);
  await serverDB.delete(walletTransactions);
  await serverDB.delete(userWallets);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ email: 'billing@example.com', id: userId });
});

afterEach(async () => {
  await serverDB.delete(trialAbuseBlocklist);
  await serverDB.delete(userTrials);
  await serverDB.delete(platformTrialConfig);
  await serverDB.delete(walletTransactions);
  await serverDB.delete(userWallets);
  await serverDB.delete(users);
});

describe('AicoBillingModel', () => {
  it('getOrCreateUserWallet is idempotent', async () => {
    const a = await model.getOrCreateUserWallet(userId);
    const b = await model.getOrCreateUserWallet(userId);
    expect(a.id).toBe(b.id);
  });

  it('updates trial config', async () => {
    const updated = await model.updateTrialConfig({
      allowedModelIds: ['openai/gpt-4o-mini'],
      durationDays: 5,
      enabled: true,
      maxRequests: 100,
      updatedByUserId: userId,
    });
    expect(updated.durationDays).toBe(5);
    expect(updated.maxRequests).toBe(100);
    expect(JSON.parse(updated.allowedModelIds)).toEqual(['openai/gpt-4o-mini']);
  });
});
