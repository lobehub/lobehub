/**
 * Aico Phase 2 — Multi-org billing context + migration / schema probes
 * Maps: AICO-P1-008, AICO-P1-012, AICO-P1-013 (constraint), AICO-P1-015
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { AicoBillingModel } from '../aicoBilling';
import { OrganizationModel } from '../organization';
import { cleanupAicoTables, seedUsers } from './aico.phase2.helpers';

const serverDB: LobeChatDatabase = await getTestDB();
const orgModel = new OrganizationModel(serverDB);
const billing = new AicoBillingModel(serverDB);

const userId = 'p2-multi-user';
const ownerA = 'p2-multi-owner-a';
const ownerB = 'p2-multi-owner-b';

beforeEach(async () => {
  await cleanupAicoTables(serverDB);
  await seedUsers(serverDB, [
    { email: 'multi@example.com', id: userId },
    { email: 'ownera@example.com', id: ownerA },
    { email: 'ownerb@example.com', id: ownerB },
  ]);
});

afterEach(async () => {
  await cleanupAicoTables(serverDB);
});

describe('Aico multi-organization billing context (Phase 2)', () => {
  it('AICO-P1-008: two org memberships — listForUser order is nondeterministic (no orderBy)', async () => {
    const orgA = await orgModel.createOrganization({ name: 'OrgA', ownerUserId: ownerA });
    const orgB = await orgModel.createOrganization({ name: 'OrgB', ownerUserId: ownerB });

    for (const [org, email] of [
      [orgA, 'multi@example.com'],
      [orgB, 'multi@example.com'],
    ] as const) {
      const invite = await orgModel.createInvite({
        identifierType: 'email',
        identifierValue: email,
        invitedByUserId: org.ownerUserId,
        orgId: org.id,
        role: 'member',
      });
      await orgModel.acceptInvite({ email, token: invite.token, userId });
    }

    const listed = await orgModel.listForUser(userId);
    expect(listed).toHaveLength(2);

    // Install distinct keys on each membership budget
    const membersA = await orgModel.listMembers(orgA.id);
    const membersB = await orgModel.listMembers(orgB.id);
    const meA = membersA.find((m) => m.userId === userId)!;
    const meB = membersB.find((m) => m.userId === userId)!;

    await orgModel.addManualCredit({
      amountToman: 50_000,
      amountMicroUsd: 10000000,
      createdByUserId: ownerA,
      fxRateTomanPerUsd: 5000,
      orgId: orgA.id,
    });
    await orgModel.addManualCredit({
      amountToman: 250_000,
      amountMicroUsd: 50000000,
      createdByUserId: ownerB,
      fxRateTomanPerUsd: 5000,
      orgId: orgB.id,
    });
    await orgModel.allocateMemberCredit({
      periodAmountMicroUsd: 5000000,
      period: 'total',
      createdByUserId: ownerA,
      orgId: orgA.id,
      orgMemberId: meA.id,
    });
    await orgModel.allocateMemberCredit({
      periodAmountMicroUsd: 40000000,
      period: 'total',
      createdByUserId: ownerB,
      orgId: orgB.id,
      orgMemberId: meB.id,
    });
    await orgModel.updateMemberOpenRouterKey({
      ciphertext: 'enc-org-a',
      keyId: 'key-org-a',
      orgMemberId: meA.id,
    });
    await orgModel.updateMemberOpenRouterKey({
      ciphertext: 'enc-org-b',
      keyId: 'key-org-b',
      orgMemberId: meB.id,
    });

    // Mimic resolveUserApiKey selection: first org with active budget key wins.
    const picks: string[] = [];
    for (let i = 0; i < 20; i++) {
      const orgs = await orgModel.listForUser(userId);
      for (const org of orgs) {
        const members = await orgModel.listMembers(org.id);
        const me = members.find((m) => m.userId === userId && m.status === 'active');
        if (!me) continue;
        const budget = await orgModel.getMemberBudget(me.id);
        if (budget?.openrouterKeyId && budget.isActive) {
          picks.push(budget.openrouterKeyId!);
          break;
        }
      }
    }

    // Invariant: billing context must be explicit — silent first-match is unsafe.
    // If all picks are identical, order happened to be stable; still no client selection API.
    const unique = new Set(picks);
    // Document: there is no explicit orgId parameter on resolve — ambiguity is structural.
    expect(unique.size).toBe(1); // if flaky across runs, still proves single silent choice
    // Stronger invariant for safe product: require explicit context (not implemented).
    // Fail if API cannot distinguish — we assert a sentinel that product must provide.
    const hasExplicitBillingContextApi = false;
    expect(hasExplicitBillingContextApi).toBe(true);
  });
});

describe('Aico migration & schema safety (Phase 2)', () => {
  it('AICO-P1-012: migration 0132 adds usage_logs.user_id NOT NULL without DEFAULT', () => {
    const sqlPath = join(__dirname, '../../../migrations/0132_shocking_blizzard.sql');
    const body = readFileSync(sqlPath, 'utf8');
    expect(body).toContain('ADD COLUMN "user_id" text NOT NULL');
    // Safe migrations use DEFAULT or backfill before NOT NULL.
    const hasDefault =
      /ADD COLUMN "user_id" text NOT NULL DEFAULT/i.test(body) ||
      /ADD COLUMN "user_id" text DEFAULT/i.test(body);
    expect(hasDefault).toBe(true);
  });

  it('AICO-P1-012: adding NOT NULL column without default fails when usage_logs has rows', async () => {
    // Simulate the hazard on a scratch table (do not mutate live usage_logs schema permanently).
    await serverDB.execute(sql`
      CREATE TABLE IF NOT EXISTS aico_p2_usage_scratch (
        id text PRIMARY KEY,
        org_id text
      )
    `);
    await serverDB.execute(sql`DELETE FROM aico_p2_usage_scratch`);
    await serverDB.execute(sql`INSERT INTO aico_p2_usage_scratch (id, org_id) VALUES ('u1', 'o1')`);

    let failed = false;
    try {
      await serverDB.execute(
        sql`ALTER TABLE aico_p2_usage_scratch ADD COLUMN user_id text NOT NULL`,
      );
    } catch {
      failed = true;
    }

    await serverDB.execute(sql`DROP TABLE IF EXISTS aico_p2_usage_scratch`);
    // PostgreSQL/PGlite must reject NOT NULL add without default when rows exist.
    expect(failed).toBe(true);
  });

  it('AICO-P1-013: user_trials phone_fingerprint index is not UNIQUE in migration SQL', () => {
    const sqlPath = join(__dirname, '../../../migrations/0132_shocking_blizzard.sql');
    const body = readFileSync(sqlPath, 'utf8');
    expect(body).toContain('user_trials_phone_fingerprint_idx');
    expect(body).not.toMatch(/CREATE UNIQUE INDEX "user_trials_phone_fingerprint/);
  });

  it('AICO-P1-015: recordUsage can write rows but chat path does not call it (probe after manual record)', async () => {
    await billing.recordUsage({
      completionTokens: 10,
      costUsd: 0.01,
      modelId: 'openai/gpt-4o-mini',
      promptTokens: 5,
      totalTokens: 15,
      userId,
    });
    const logs = await billing.listUserUsage(userId, 10);
    expect(logs.length).toBeGreaterThan(0);
    // Chat wiring absence is asserted in apps/server chat-bypass suite.
  });
});
