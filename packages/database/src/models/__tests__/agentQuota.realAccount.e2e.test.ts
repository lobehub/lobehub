// @vitest-environment node
/**
 * Real-account × local-Postgres E2E for the quota fossilization pipeline.
 *
 * Gated behind QUOTA_E2E=1 (hits the machine's Keychain + the live Anthropic
 * usage API, so it never runs in the normal suite). Run with:
 *   TEST_SERVER_DB=1 DATABASE_TEST_URL=postgresql://postgres:postgres@localhost:5433/postgres \
 *   QUOTA_E2E=1 KEY_VAULTS_SECRET=<b64> bunx vitest run agentQuota.realAccount.e2e
 *
 * Drives the same model + pure-logic code paths AgentQuotaService composes,
 * against the real local DB with the real Claude login.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  calibrateCapacity,
  mapClaudeUsageToReadings,
  parseClaudeAccountIdentity,
  projectWindows,
  type QuotaAccountIdentity,
  type QuotaLimitReading,
  windowsToCalibrationIntervals,
} from '@lobechat/heterogeneous-agents/quota';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentProviderAccountModel,
  AgentQuotaSnapshotModel,
  AgentQuotaUsageLedgerModel,
  AgentQuotaWindowModel,
} from '../agentQuota';

const RUN = process.env.QUOTA_E2E === '1';
const USER_ID = 'quota-e2e-real-user';

const readToken = (): string => {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8' },
    );
    return JSON.parse(out.trim()).claudeAiOauth.accessToken;
  } catch {
    const raw = readFileSync(path.join(homedir(), '.claude', '.credentials.json'), 'utf8');
    return JSON.parse(raw).claudeAiOauth.accessToken;
  }
};

describe.skipIf(!RUN)('quota real-account E2E (local DB)', () => {
  let db: LobeChatDatabase;
  let identity: QuotaAccountIdentity;
  let readings: QuotaLimitReading[];

  beforeAll(async () => {
    db = await getTestDB();
    identity = parseClaudeAccountIdentity(
      readFileSync(path.join(homedir(), '.claude.json'), 'utf8'),
    )!;

    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${readToken()}`,
        'User-Agent': 'claude-cli/2.1.198 (external, cli)',
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });
    const payload = await res.json();
    if (payload?.error) throw new Error('usage API error: ' + JSON.stringify(payload.error));
    readings = mapClaudeUsageToReadings(payload, Date.now());

    console.log('\n[E2E] identity', JSON.stringify(identity));

    console.log('[E2E] live readings', JSON.stringify(readings));

    await db.delete(users).where(eq(users.id, USER_ID));
    await db.insert(users).values({ id: USER_ID }).onConflictDoNothing();
  });

  afterAll(async () => {
    if (db) await db.delete(users).where(eq(users.id, USER_ID));
  });

  it('fossilizes the live reading into account + windows on the local DB', async () => {
    expect(identity.externalAccountId).toBeTruthy();
    expect(readings.length).toBeGreaterThan(0);

    const accounts = new AgentProviderAccountModel(db, USER_ID);
    const snapshots = new AgentQuotaSnapshotModel(db, USER_ID);
    const windows = new AgentQuotaWindowModel(db, USER_ID);
    const ledger = new AgentQuotaUsageLedgerModel(db, USER_ID);

    // 1) dedupe account by real identity
    const account = await accounts.upsertByIdentity('claude-code', identity, {
      credentialRef: { origin: 'keychain' },
    });
    expect(account.externalAccountId).toBe(identity.externalAccountId);
    expect(account.email).toBe(identity.email);
    expect(account.credentialMode).toBe('referenced');
    // no plaintext credential ever stored in referenced mode
    expect(account).not.toHaveProperty('credentials');

    // 2) persist the live readings
    await snapshots.append(
      readings.map((r) => ({
        accountId: account.id,
        capturedAt: new Date(r.capturedAt),
        isActive: r.isActive,
        limitType: r.limitType,
        resetsAt: r.resetsAt == null ? null : new Date(r.resetsAt),
        scopeKey: r.scopeKey,
        severity: r.severity,
        utilization: r.utilization,
      })),
    );

    // 3) project → windows (observed cost from ledger; none yet, so 0)
    for (const w of projectWindows(readings)) {
      const observedCostUsd = await ledger.sumCostUsd(
        account.id,
        new Date(w.windowStartAt),
        new Date(w.resetsAt),
      );
      await windows.upsert({
        accountId: account.id,
        limitType: w.limitType,
        observedCostUsd,
        peakUtilization: w.peakUtilization,
        resetsAt: new Date(w.resetsAt),
        scopeKey: w.scopeKey,
        windowSeconds: w.windowSeconds,
        windowStartAt: new Date(w.windowStartAt),
      });
    }

    // 4) windows round-trip and match the live reading exactly
    const stored = await windows.listByAccount(account.id);
    const withReset = readings.filter((r) => r.resetsAt != null);
    expect(stored.length).toBe(withReset.length);
    for (const r of withReset) {
      const w = stored.find((x) => x.limitType === r.limitType && x.scopeKey === r.scopeKey);
      expect(w, `window for ${r.limitType}/${r.scopeKey}`).toBeTruthy();
      expect(w!.peakUtilization).toBe(r.utilization);
      expect(w!.resetsAt!.getTime()).toBe(r.resetsAt);
      // window start is exactly resets_at - windowSeconds
      expect(w!.resetsAt!.getTime() - w!.windowStartAt!.getTime()).toBe(w!.windowSeconds * 1000);
    }

    // 5) calibration input builds without throwing (few windows → may be null)
    const calibration = calibrateCapacity(
      windowsToCalibrationIntervals(
        stored.map((w) => ({
          contaminated: w.contaminated,
          observedCostUsd: w.observedCostUsd == null ? null : Number(w.observedCostUsd),
          peakUtilization: w.peakUtilization,
          rateLimitedAt: w.rateLimitedAt ? w.rateLimitedAt.getTime() : null,
        })),
      ),
    );
    // with a single live snapshot there aren't enough samples yet — that's fine
    expect(calibration === null || calibration.capacityUsd > 0).toBe(true);

    console.log(
      '[E2E] persisted windows',
      stored
        .map((w) => `${w.limitType}${w.scopeKey ? '/' + w.scopeKey : ''}=${w.peakUtilization}%`)
        .join(' '),
    );
  });
});
