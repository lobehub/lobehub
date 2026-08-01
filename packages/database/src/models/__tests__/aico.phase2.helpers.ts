/**
 * Shared setup/cleanup for Aico Phase 2 adversarial tests.
 * Finding coverage: AICO-P1-* suite scaffolding.
 */
import {
  aicoUserPublicIds,
  memberBudgets,
  modelAccessRules,
  organizationInvites,
  organizationMembers,
  organizations,
  organizationTeamMembers,
  organizationTeams,
  platformAdmins,
  platformTrialConfig,
  trialAbuseBlocklist,
  usageLogs,
  userTrials,
  userWallets,
  walletTransactions,
} from '../../schemas/aicoOrganization';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';

export const cleanupAicoTables = async (db: LobeChatDatabase) => {
  await db.delete(usageLogs);
  await db.delete(trialAbuseBlocklist);
  await db.delete(userTrials);
  await db.delete(platformTrialConfig);
  await db.delete(walletTransactions);
  await db.delete(memberBudgets);
  await db.delete(modelAccessRules);
  await db.delete(organizationTeamMembers);
  await db.delete(organizationTeams);
  await db.delete(organizationInvites);
  await db.delete(organizationMembers);
  await db.delete(organizations);
  await db.delete(userWallets);
  await db.delete(platformAdmins);
  await db.delete(aicoUserPublicIds);
  await db.delete(users);
};

export const seedUsers = async (
  db: LobeChatDatabase,
  rows: Array<{
    email: string;
    id: string;
    phone?: string | null;
    phoneNumberVerified?: boolean | null;
  }>,
) => {
  await db.insert(users).values(
    rows.map((r) => ({
      email: r.email,
      id: r.id,
      phone: r.phone ?? null,
      phoneNumberVerified: r.phoneNumberVerified ?? false,
    })),
  );
};

export const isServerDb = () => process.env.TEST_SERVER_DB === '1';
