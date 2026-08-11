import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  platformFxConfig,
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
  await serverDB.delete(platformFxConfig);
  await serverDB.delete(platformTrialConfig);
  await serverDB.delete(walletTransactions);
  await serverDB.delete(userWallets);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ email: 'billing@example.com', id: userId });
});

afterEach(async () => {
  await serverDB.delete(trialAbuseBlocklist);
  await serverDB.delete(userTrials);
  await serverDB.delete(platformFxConfig);
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

  it('persists billing preference for SPA pre-select', async () => {
    const preference = await model.setBillingPreference({
      organizationId: 'org-pref',
      source: 'organization',
      userId,
    });
    expect(preference.preferredBillingSource).toBe('organization');
    expect(preference.preferredOrganizationId).toBe('org-pref');

    const personal = await model.setBillingPreference({
      source: 'personal',
      userId,
    });
    expect(personal.preferredBillingSource).toBe('personal');
    expect(personal.preferredOrganizationId).toBeNull();
  });

  it('getFxConfig seeds 187400 and updateFxConfig persists admin rate', async () => {
    const seeded = await model.getFxConfig();
    expect(seeded.id).toBe('default');
    expect(Number(seeded.tomanPerUsd)).toBe(187_400);

    const updated = await model.updateFxConfig({
      tomanPerUsd: 200_000,
      updatedByUserId: userId,
    });
    expect(Number(updated.tomanPerUsd)).toBe(200_000);
    expect(updated.updatedByUserId).toBe(userId);

    const again = await model.getFxConfig();
    expect(Number(again.tomanPerUsd)).toBe(200_000);
  });
});
