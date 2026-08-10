/**
 * Shared personas + invariant helpers for Aico Phase 3 release gate.
 * Fake Iranian phones only — no real customer data.
 */
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';

import {
  memberBudgets,
  organizationMembers,
  organizations,
  organizationTeamMembers,
  organizationTeams,
  usageLogs,
  userTrials,
  userWallets,
  walletTransactions,
} from '../../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../../type';
import { cleanupAicoTables, seedUsers } from './aico.phase2.helpers';

/** Isolated Phase 3 persona IDs (fake). */
export const P3 = {
  attacker: 'p3-attacker',
  b2cNoPhone: 'p3-b2c-nophone',
  b2cVerified: 'p3-b2c-verified',
  deletedRecreated: 'p3-deleted-recreated',
  disabledMember: 'p3-disabled-member',
  exhaustedTrial: 'p3-exhausted-trial',
  invitedSkipPhone: 'p3-invited-skip-phone',
  multiOrg: 'p3-multi-org',
  orgAdmin: 'p3-org-admin',
  orgMember: 'p3-org-member',
  orgOwner: 'p3-org-owner',
  personalAndOrg: 'p3-personal-and-org',
  platformAdmin: 'p3-platform-admin',
  removedMember: 'p3-removed-member',
  suspendedMember: 'p3-suspended-member',
  trialActive: 'p3-trial-active',
  unrelated: 'p3-unrelated',
} as const;

export const P3_PHONES = {
  b2cVerified: '+989121000001',
  deletedRecreated: '+989121000016',
  exhaustedTrial: '+989121000012',
  invitedSkipPhone: '+989121000008',
  multiOrg: '+989121000009',
  orgAdmin: '+989121000003',
  orgMember: '+989121000004',
  orgOwner: '+989121000002',
  personalAndOrg: '+989121000010',
  trialActive: '+989121000011',
} as const;

export const seedPhase3Personas = async (db: LobeChatDatabase) => {
  await cleanupAicoTables(db);
  await seedUsers(db, [
    {
      email: 'platform@p3.aico.test',
      id: P3.platformAdmin,
      phone: '+989120000000',
      phoneNumberVerified: true,
    },
    {
      email: 'owner@p3.aico.test',
      id: P3.orgOwner,
      phone: P3_PHONES.orgOwner,
      phoneNumberVerified: true,
    },
    {
      email: 'admin@p3.aico.test',
      id: P3.orgAdmin,
      phone: P3_PHONES.orgAdmin,
      phoneNumberVerified: true,
    },
    {
      email: 'member@p3.aico.test',
      id: P3.orgMember,
      phone: P3_PHONES.orgMember,
      phoneNumberVerified: false,
    },
    { email: 'unrelated@p3.aico.test', id: P3.unrelated },
    {
      email: 'b2c-verified@p3.aico.test',
      id: P3.b2cVerified,
      phone: P3_PHONES.b2cVerified,
      phoneNumberVerified: true,
    },
    { email: 'b2c-nophone@p3.aico.test', id: P3.b2cNoPhone, phoneNumberVerified: false },
    {
      email: 'invited@p3.aico.test',
      id: P3.invitedSkipPhone,
      phone: P3_PHONES.invitedSkipPhone,
      phoneNumberVerified: false,
    },
    {
      email: 'multiorg@p3.aico.test',
      id: P3.multiOrg,
      phone: P3_PHONES.multiOrg,
      phoneNumberVerified: true,
    },
    {
      email: 'personal-org@p3.aico.test',
      id: P3.personalAndOrg,
      phone: P3_PHONES.personalAndOrg,
      phoneNumberVerified: true,
    },
    {
      email: 'trial-active@p3.aico.test',
      id: P3.trialActive,
      phone: P3_PHONES.trialActive,
      phoneNumberVerified: true,
    },
    {
      email: 'trial-exhausted@p3.aico.test',
      id: P3.exhaustedTrial,
      phone: P3_PHONES.exhaustedTrial,
      phoneNumberVerified: true,
    },
    { email: 'removed@p3.aico.test', id: P3.removedMember },
    { email: 'disabled@p3.aico.test', id: P3.disabledMember },
    { email: 'suspended-mem@p3.aico.test', id: P3.suspendedMember },
    {
      email: 'recreated@p3.aico.test',
      id: P3.deletedRecreated,
      phone: P3_PHONES.deletedRecreated,
      phoneNumberVerified: true,
    },
    { email: 'attacker@p3.aico.test', id: P3.attacker },
  ]);
};

export type IntegrityReport = {
  activeMembersWithoutOrg: number;
  crossOrgTeamMemberships: number;
  duplicateTrialFingerprints: number;
  negativeOrgWallets: number;
  orgsWithoutExactlyOneDefaultTeam: number;
};

/**
 * End-of-journey database invariants for release gate.
 */
export const collectAicoDataIntegrity = async (db: LobeChatDatabase): Promise<IntegrityReport> => {
  const negativeOrgs = await db
    .select({ id: organizations.id, usd: organizations.walletBalanceMicroUsd })
    .from(organizations)
    .where(sql`${organizations.walletBalanceMicroUsd} < 0`);

  const fingerprintDupes = await db.execute(sql`
    SELECT phone_fingerprint AS fp, COUNT(*)::int AS c
    FROM user_trials
    GROUP BY phone_fingerprint
    HAVING COUNT(*) > 1
  `);

  const orphanMembers = await db.execute(sql`
    SELECT m.id
    FROM organization_members m
    LEFT JOIN organizations o ON o.id = m.org_id
    WHERE m.status = 'active' AND o.id IS NULL
  `);

  const crossTeam = await db.execute(sql`
    SELECT tm.id
    FROM organization_team_members tm
    JOIN organization_teams t ON t.id = tm.team_id
    JOIN organization_members m ON m.id = tm.org_member_id
    WHERE t.org_id <> m.org_id
  `);

  const defaultTeamCounts = await db.execute(sql`
    SELECT org_id, COUNT(*)::int AS c
    FROM organization_teams
    WHERE is_default = true
    GROUP BY org_id
    HAVING COUNT(*) <> 1
  `);

  const rowCount = (result: { rows?: unknown[] } | unknown[]) => {
    if (Array.isArray(result)) return result.length;
    return (result.rows ?? []).length;
  };

  return {
    activeMembersWithoutOrg: rowCount(orphanMembers as { rows?: unknown[] }),
    crossOrgTeamMemberships: rowCount(crossTeam as { rows?: unknown[] }),
    duplicateTrialFingerprints: rowCount(fingerprintDupes as { rows?: unknown[] }),
    negativeOrgWallets: negativeOrgs.length,
    orgsWithoutExactlyOneDefaultTeam: rowCount(defaultTeamCounts as { rows?: unknown[] }),
  };
};

export const expectReleaseInvariants = (report: IntegrityReport) => {
  expect(report.negativeOrgWallets).toBe(0);
  expect(report.duplicateTrialFingerprints).toBe(0);
  expect(report.activeMembersWithoutOrg).toBe(0);
  expect(report.crossOrgTeamMemberships).toBe(0);
  expect(report.orgsWithoutExactlyOneDefaultTeam).toBe(0);
};

export {
  cleanupAicoTables,
  memberBudgets,
  organizationMembers,
  organizations,
  organizationTeamMembers,
  organizationTeams,
  usageLogs,
  userTrials,
  userWallets,
  walletTransactions,
};
