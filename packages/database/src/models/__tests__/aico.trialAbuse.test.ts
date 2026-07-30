/**
 * Aico Phase 2 — Trial concurrency & abuse
 * Maps: AICO-P1-003, AICO-P1-010, AICO-P1-013, AICO-P1-019, AICO-P1-020, AICO-P1-021
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { userTrials } from '../../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../../type';
import { AicoBillingModel, fingerprintPhone } from '../aicoBilling';
import { cleanupAicoTables, isServerDb, seedUsers } from './aico.phase2.helpers';

const serverDB: LobeChatDatabase = await getTestDB();
const billing = new AicoBillingModel(serverDB);

const u1 = 'p2-trial-u1';
const u2 = 'p2-trial-u2';
const u3 = 'p2-trial-u3';
const CANONICAL = '+989121111111';

beforeEach(async () => {
  await cleanupAicoTables(serverDB);
  // users.phone is UNIQUE — store distinct phones; activateTrial still receives CANONICAL
  // to probe fingerprint uniqueness independent of the users table constraint.
  await seedUsers(serverDB, [
    { email: 't1@example.com', id: u1, phone: '+989121111111', phoneNumberVerified: true },
    { email: 't2@example.com', id: u2, phone: '+989121111112', phoneNumberVerified: true },
    { email: 't3@example.com', id: u3, phone: '+989122222222', phoneNumberVerified: true },
  ]);
  await billing.updateTrialConfig({
    allowedModelIds: ['openai/gpt-4o-mini'],
    durationDays: 3,
    enabled: true,
    maxRequests: 1,
    updatedByUserId: u1,
  });
});

afterEach(async () => {
  await cleanupAicoTables(serverDB);
});

describe('Aico trial abuse & concurrency (Phase 2)', () => {
  it('AICO-P1-013: two users activating trial with same phone — exactly one row', async () => {
    const results = await Promise.allSettled([
      billing.activateTrial({ phone: CANONICAL, userId: u1 }),
      billing.activateTrial({ phone: CANONICAL, userId: u2 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rows = await serverDB.query.userTrials.findMany({
      where: eq(userTrials.phoneFingerprint, fingerprintPhone(CANONICAL)),
    });

    expect(rows).toHaveLength(1);
    expect(fulfilled.length).toBe(1);
  });

  it('AICO-P1-013: DB has no UNIQUE on phone_fingerprint (schema invariant probe)', async () => {
    // Prove missing unique constraint by inserting two rows with same fingerprint via raw SQL path
    // if app-level race is won — use direct insert bypassing activateTrial checks for constraint probe.
    const fp = fingerprintPhone(CANONICAL);
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 86_400_000);

    await serverDB.insert(userTrials).values({
      expiresAt,
      phoneFingerprint: fp,
      startedAt,
      status: 'active',
      userId: u1,
    });

    // Second insert with SAME fingerprint, different user — succeeds if no UNIQUE
    let secondOk = false;
    try {
      await serverDB.insert(userTrials).values({
        expiresAt,
        phoneFingerprint: fp,
        startedAt,
        status: 'active',
        userId: u2,
      });
      secondOk = true;
    } catch {
      secondOk = false;
    }

    // Safety invariant: second insert must fail (unique constraint).
    expect(secondOk).toBe(false);
  });

  it('AICO-P1-021: phone format variants must canonicalize to one fingerprint', async () => {
    const variants = [
      '09121111111',
      '989121111111',
      '+989121111111',
      '0912-111-1111',
      '۰۹۱۲۱۱۱۱۱۱۱', // Persian digits
      '٠٩١٢١١١١١١١', // Arabic-Indic digits
    ];

    const fingerprints = new Set(variants.map((v) => fingerprintPhone(v)));
    // Expected: all canonicalize to same fingerprint after normalize.
    // Actual fingerprintPhone only trims — variants diverge.
    expect(fingerprints.size).toBe(1);
  });

  it('AICO-P1-010: trial request increment lacks atomic reserve — parallel increments exceed maxRequests', async () => {
    await billing.activateTrial({ phone: CANONICAL, userId: u1 });
    const config = await billing.getTrialConfig();
    expect(config.maxRequests).toBe(1);

    // Soft check pattern used by chatGuard: read count then increment after success.
    // Parallel increments both succeed → count > maxRequests.
    await Promise.all([
      billing.incrementTrialRequest(u1),
      billing.incrementTrialRequest(u1),
      billing.incrementTrialRequest(u1),
    ]);

    const trial = await billing.getUserTrial(u1);
    // Invariant: requestCount must never exceed maxRequests without atomic reservation.
    expect(trial?.requestCount).toBeLessThanOrEqual(config.maxRequests!);
  });

  it('AICO-P1-010: assert-style check with stale count allows double spend of last request', async () => {
    await billing.activateTrial({ phone: CANONICAL, userId: u1 });
    // Simulate chatGuard TOCTOU: both readers see count=0 < max=1, both "succeed", both increment.
    const trial = await billing.getUserTrial(u1);
    const config = await billing.getTrialConfig();
    const canProceed = (count: number) =>
      config.maxRequests == null || count < config.maxRequests;

    expect(canProceed(trial!.requestCount)).toBe(true);
    expect(canProceed(trial!.requestCount)).toBe(true); // second concurrent reader also passes

    await billing.incrementTrialRequest(u1);
    await billing.incrementTrialRequest(u1);

    const after = await billing.getUserTrial(u1);
    // Safe system would reserve before upstream call so count never exceeds max.
    expect(after!.requestCount).toBeLessThanOrEqual(config.maxRequests!);
  });

  it('AICO-P1-019: blocklist write then delete is not atomic — blocklist remains if delete skipped', async () => {
    await billing.addAbuseBlocklist({
      email: 't3@example.com',
      phone: '+989122222222',
      reason: 'account_deletion',
    });
    // Simulate crash after blocklist, before user delete: user still exists, phone blocked.
    expect(await billing.isPhoneBlockedForTrial('+989122222222')).toBe(true);
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../../schemas/user');
    const userStillExists = await serverDB.query.users.findFirst({
      where: eq(users.id, u3),
    });
    expect(userStillExists).toBeTruthy();
    // Split state (blocklisted while user still exists) is reachable with current sequencing.
    expect(await billing.isPhoneBlockedForTrial('+989122222222')).toBe(true);
  });

  it('AICO-P1-019: recreation after blocklist cannot activate trial', async () => {
    await billing.addAbuseBlocklist({ phone: CANONICAL, reason: 'account_deletion' });
    await expect(billing.activateTrial({ phone: CANONICAL, userId: u1 })).rejects.toThrow(
      'TRIAL_PHONE_BLOCKED',
    );
  });

  it('disabled trial config rejects activation', async () => {
    await billing.updateTrialConfig({ enabled: false, updatedByUserId: u1 });
    await expect(billing.activateTrial({ phone: CANONICAL, userId: u1 })).rejects.toThrow(
      'TRIAL_DISABLED',
    );
  });

  it.skipIf(!isServerDb())(
    'AICO-P1-013 (server-db): parallel activateTrial same phone — one success',
    async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          billing.activateTrial({
            phone: CANONICAL,
            userId: i % 2 === 0 ? u1 : u2,
          }),
        ),
      );
      const rows = await serverDB.query.userTrials.findMany({
        where: eq(userTrials.phoneFingerprint, fingerprintPhone(CANONICAL)),
      });
      expect(rows).toHaveLength(1);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    },
  );
});
