// @vitest-environment node
/**
 * End-to-end proof of the "fossilize the quota reading" pipeline against a real
 * (in-memory) Postgres, with no live Claude account:
 *   parse identity → account → snapshots → windows → ledger → calibrate → LB.
 * Uses the same math that recovered ~$548 / 5h from real logs.
 */
import {
  type AccountLoad,
  calibrateCapacity,
  computeTurnCostUsd,
  parseClaudeAccountIdentity,
  projectWindows,
  type QuotaLimitReading,
  selectAccount,
  windowsToCalibrationIntervals,
} from '@lobechat/heterogeneous-agents/quota';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentProviderAccountModel,
  AgentQuotaCalibrationModel,
  AgentQuotaSnapshotModel,
  AgentQuotaUsageLedgerModel,
  AgentQuotaWindowModel,
} from '../agentQuota';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'quota-pipeline-user';
const secret = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';
let original: string | undefined;

beforeEach(async () => {
  original = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = secret;
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});
afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  process.env.KEY_VAULTS_SECRET = original;
});

describe('quota fossilization pipeline', () => {
  it('goes identity → account → snapshots → windows → ledger → calibration → LB', async () => {
    const accounts = new AgentProviderAccountModel(serverDB, userId);
    const snapshots = new AgentQuotaSnapshotModel(serverDB, userId);
    const windows = new AgentQuotaWindowModel(serverDB, userId);
    const ledger = new AgentQuotaUsageLedgerModel(serverDB, userId);
    const calibrations = new AgentQuotaCalibrationModel(serverDB, userId);

    // 1) identity from ~/.claude.json → account (referenced mode)
    const identity = parseClaudeAccountIdentity(
      JSON.stringify({
        oauthAccount: {
          accountUuid: 'acc-uuid-1',
          emailAddress: 'a@example.com',
          organizationRateLimitTier: 'default_claude_max_20x',
          organizationType: 'claude_max',
        },
      }),
    )!;
    const account = await accounts.upsertByIdentity('claude-code', identity, {
      credentialRef: { origin: 'keychain' },
    });
    expect(account.planTier).toBe('max');

    // 2) build four clean 5h windows at ~$5.5 per utilization point, plus their
    //    provider readings + our ledger turns.
    const HOUR = 3_600_000;
    const samples = [
      { cost: 142, start: Date.parse('2026-07-01T00:00:00Z'), util: 26 },
      { cost: 300, start: Date.parse('2026-07-01T05:00:00Z'), util: 55 },
      { cost: 210, start: Date.parse('2026-07-01T10:00:00Z'), util: 38 },
      { cost: 90, start: Date.parse('2026-07-01T15:00:00Z'), util: 16 },
    ];
    const readings: QuotaLimitReading[] = [];
    for (const [i, s] of samples.entries()) {
      const resetsAt = s.start + 5 * HOUR;
      // two readings per window: rising utilization (monotonic)
      readings.push(
        {
          capturedAt: s.start + HOUR,
          limitType: 'session',
          resetsAt,
          scopeKey: '',
          utilization: Math.round(s.util / 2),
        },
        {
          capturedAt: s.start + 4 * HOUR,
          limitType: 'session',
          resetsAt,
          scopeKey: '',
          utilization: s.util,
        },
      );
      await snapshots.append(
        readings.slice(-2).map((r) => ({
          accountId: account.id,
          capturedAt: new Date(r.capturedAt),
          limitType: r.limitType,
          resetsAt: new Date(r.resetsAt!),
          scopeKey: r.scopeKey,
          utilization: r.utilization,
        })),
      );
      // ledger: one opus turn whose computed cost equals the window's spend.
      // opus $5/$25 per MTok; pick output tokens so cost ≈ s.cost.
      const outputTokens = Math.round((s.cost / 25) * 1e6);
      const cost = computeTurnCostUsd({ output: outputTokens }, { input: 5, output: 25 });
      await ledger.append({
        accountId: account.id,
        costUsd: cost,
        externalEventId: `turn-${i}`,
        model: 'claude-opus-4-8',
        occurredAt: new Date(s.start + 2 * HOUR),
        outputTokens,
        provider: 'claude-code',
      });
    }

    // 3) project windows (pure) and materialize them with observed ledger cost
    const projected = projectWindows(readings);
    expect(projected).toHaveLength(4);
    for (const w of projected) {
      const observedCostUsd = await ledger.sumCostUsd(
        account.id,
        new Date(w.windowStartAt),
        new Date(w.resetsAt),
      );
      await windows.upsert({
        accountId: account.id,
        contaminated: false,
        limitType: w.limitType,
        observedCostUsd,
        peakUtilization: w.peakUtilization,
        resetsAt: new Date(w.resetsAt),
        scopeKey: w.scopeKey,
        windowSeconds: w.windowSeconds,
        windowStartAt: new Date(w.windowStartAt),
      });
    }

    const stored = await windows.listByAccount(account.id);
    expect(stored).toHaveLength(4);

    // 4) calibrate capacity from the stored windows
    const intervals = windowsToCalibrationIntervals(
      stored.map((w) => ({
        contaminated: w.contaminated,
        observedCostUsd: w.observedCostUsd == null ? null : Number(w.observedCostUsd),
        peakUtilization: w.peakUtilization,
        rateLimitedAt: w.rateLimitedAt ? w.rateLimitedAt.getTime() : null,
      })),
    );
    const calibration = calibrateCapacity(intervals)!;
    expect(calibration.capacityUsd).toBeGreaterThan(450);
    expect(calibration.capacityUsd).toBeLessThan(650);
    await calibrations.insert({
      accountId: account.id,
      capacityUsd: calibration.capacityUsd,
      confidence: calibration.confidence,
      limitType: 'session',
      method: calibration.method,
      sampleCount: calibration.sampleCount,
      scopeKey: '',
      windowSeconds: 18_000,
    });
    const latest = await calibrations.latest(account.id, 'session');
    expect(Number(latest?.capacityUsd)).toBeCloseTo(calibration.capacityUsd, 3);

    // 5) load-balance across this account + a second, weekly-heavier account
    const loads: AccountLoad[] = [
      { accountId: account.id, enabled: true, priority: 0, weeklyUtil: 72 },
      { accountId: 'other', enabled: true, priority: 0, weeklyUtil: 30 },
    ];
    expect(selectAccount(loads, { now: Date.now() })?.accountId).toBe('other');
  });
});
